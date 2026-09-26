import { Router, type Response } from 'express'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireActiveUser, requireAuth } from '../middleware/auth.middleware.js'
import { storage } from '../services/storage/local.storage.js'

const router = Router()
const nameSchema = z.string().trim().transform(normaliseName).pipe(z.string().min(1).max(255))
const initSchema = z.object({ name: nameSchema, mimeType: z.string().trim().min(1).max(160), size: z.number().int().positive().max(5 * 1024 * 1024 * 1024), folderId: z.string().cuid().nullable().optional() })
const updateSchema = z.object({ name: nameSchema.optional(), folderId: z.string().cuid().nullable().optional() }).strict()
const maxUploadBytes = 5 * 1024 * 1024 * 1024

router.use(requireAuth, requireActiveUser)

router.get('/', async (request, response) => {
  const page = parsePositiveInt(request.query.page, 1)
  const limit = Math.min(parsePositiveInt(request.query.limit, 50), 100)
  const folderId = typeof request.query.folderId === 'string' ? request.query.folderId : null
  const where = { ownerId: request.user!.id, folderId, deletedAt: null }
  const [files, total] = await Promise.all([
    prisma.file.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.file.count({ where }),
  ])
  response.json({ success: true, data: { files: files.map(toFileResponse), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } })
})

router.get('/:id', async (request, response) => {
  const file = await ownedFile(request.params.id, request.user!.id)
  if (!file) {
    response.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found' } })
    return
  }
  response.json({ success: true, data: { file: toFileResponse(file) } })
})

router.get('/:id/download', async (request, response) => {
  const file = await ownedFile(request.params.id, request.user!.id)
  if (!file) {
    response.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found' } })
    return
  }
  const url = `${request.protocol}://${request.get('host')}${request.baseUrl}/${file.id}/content`
  await prisma.activity.create({ data: { userId: request.user!.id, action: 'FILE_DOWNLOAD', entityType: 'FILE', entityId: file.id } })
  response.json({ success: true, data: { url } })
})

router.get('/:id/content', async (request, response) => {
  const file = await ownedFile(request.params.id, request.user!.id)
  if (!file) {
    response.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found' } })
    return
  }
  await streamFile(file, response, true)
})

router.get('/:id/preview', async (request, response) => {
  const file = await ownedFile(request.params.id, request.user!.id)
  if (!file) {
    response.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found' } })
    return
  }
  await streamFile(file, response, false)
})

router.post('/upload/initiate', async (request, response) => {
  const parsed = initSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'File metadata is invalid' } })
    return
  }
  const { name, mimeType, size, folderId } = parsed.data
  if (size > maxUploadBytes) {
    response.status(413).json({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'This file exceeds the upload limit' } })
    return
  }
  const folder = folderId ? await prisma.folder.findFirst({ where: { id: folderId, ownerId: request.user!.id, deletedAt: null } }) : null
  if (folderId && !folder) {
    response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Destination folder not found' } })
    return
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id }, select: { storageQuota: true, storageUsed: true } })
  if (user.storageUsed + BigInt(size) > user.storageQuota) {
    response.status(413).json({ success: false, error: { code: 'STORAGE_QUOTA_EXCEEDED', message: 'Storage quota exceeded' } })
    return
  }
  const key = storage.createFileKey()
  const session = await prisma.uploadSession.create({ data: { userId: request.user!.id, folderId: folder?.id, name, originalName: name, mimeType, size: BigInt(size), storageKey: key, expiresAt: new Date(Date.now() + 15 * 60 * 1000) } })
  response.status(201).json({ success: true, data: { sessionId: session.id, uploadPath: `/files/upload/${session.id}/content`, expiresAt: session.expiresAt } })
})

router.put('/upload/:sessionId/content', async (request, response) => {
  const session = await prisma.uploadSession.findFirst({ where: { id: request.params.sessionId, userId: request.user!.id } })
  if (!session || session.expiresAt < new Date()) {
    response.status(404).json({ success: false, error: { code: 'UPLOAD_SESSION_NOT_FOUND', message: 'Upload session expired or not found' } })
    return
  }
  try {
    await storage.writeObject(session.storageKey, request, Number(session.size))
    response.status(204).send()
  } catch {
    await storage.deleteObject(session.storageKey).catch(() => undefined)
    await prisma.uploadSession.delete({ where: { id: session.id } }).catch(() => undefined)
    response.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: 'The upload did not match the expected file size or could not be saved.' } })
  }
})

router.post('/upload/finalize', async (request, response) => {
  const parsed = z.object({ sessionId: z.string().cuid() }).safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Upload session is invalid' } })
    return
  }
  const session = await prisma.uploadSession.findFirst({ where: { id: parsed.data.sessionId, userId: request.user!.id } })
  if (!session || session.expiresAt < new Date()) {
    response.status(404).json({ success: false, error: { code: 'UPLOAD_SESSION_NOT_FOUND', message: 'Upload session expired or not found' } })
    return
  }
  const metadata = await storage.objectMetadata(session.storageKey)
  if (!metadata) {
    response.status(409).json({ success: false, error: { code: 'UPLOAD_NOT_FOUND', message: 'Uploaded object was not found in storage' } })
    return
  }
  if (metadata.size !== Number(session.size)) {
    response.status(409).json({ success: false, error: { code: 'UPLOAD_SIZE_MISMATCH', message: 'Uploaded object size does not match the upload session' } })
    return
  }
  const file = await prisma.$transaction(async (transaction) => {
    const created = await transaction.file.create({ data: { name: session.name, originalName: session.originalName, mimeType: session.mimeType, size: session.size, storageKey: session.storageKey, ownerId: session.userId, folderId: session.folderId } })
    await transaction.user.update({ where: { id: session.userId }, data: { storageUsed: { increment: session.size } } })
    await transaction.activity.create({ data: { userId: session.userId, action: 'FILE_UPLOAD', entityType: 'FILE', entityId: created.id } })
    await transaction.uploadSession.delete({ where: { id: session.id } })
    return created
  })
  response.status(201).json({ success: true, data: { file: toFileResponse(file) } })
})

router.patch('/:id', async (request, response) => {
  const parsed = updateSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'File update is invalid' } })
    return
  }
  const file = await ownedFile(request.params.id, request.user!.id)
  if (!file) {
    response.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found' } })
    return
  }
  if (parsed.data.folderId !== undefined && parsed.data.folderId !== null) {
    const folder = await prisma.folder.findFirst({ where: { id: parsed.data.folderId, ownerId: request.user!.id, deletedAt: null } })
    if (!folder) {
      response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Destination folder not found' } })
      return
    }
  }
  const updated = await prisma.file.update({ where: { id: file.id }, data: parsed.data })
  response.json({ success: true, data: { file: toFileResponse(updated) } })
})

router.delete('/:id', async (request, response) => {
  const file = await ownedFile(request.params.id, request.user!.id)
  if (!file) {
    response.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found' } })
    return
  }
  await prisma.$transaction([
    prisma.file.update({ where: { id: file.id }, data: { deletedAt: new Date() } }),
    prisma.trashItem.create({ data: { userId: request.user!.id, fileId: file.id, reason: 'user_deleted' } }),
    prisma.activity.create({ data: { userId: request.user!.id, action: 'FILE_DELETE', entityType: 'FILE', entityId: file.id } }),
  ])
  response.status(204).send()
})

async function ownedFile(id: string, ownerId: string) {
  return prisma.file.findFirst({ where: { id, ownerId, deletedAt: null } })
}

function toFileResponse(file: { id: string; name: string; originalName: string; mimeType: string; size: bigint; ownerId: string; folderId: string | null; version: number; checksum: string | null; createdAt: Date; updatedAt: Date; deletedAt: Date | null }) {
  return { ...file, size: file.size.toString() }
}

async function streamFile(file: { storageKey: string; mimeType: string; originalName: string; size: bigint }, response: Response, download: boolean) {
  response.type(file.mimeType)
  if (download) response.attachment(file.originalName)
  else response.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`)
  response.setHeader('Content-Length', file.size.toString())
  try {
    await pipeline(storage.createReadStream(file.storageKey), response as unknown as NodeJS.WritableStream)
  } catch {
    if (!response.headersSent) response.status(404).json({ success: false, error: { code: 'FILE_CONTENT_NOT_FOUND', message: 'File content is unavailable' } })
    else response.destroy()
  }
}

function normaliseName(value: string) {
  return value.replace(/[\\/]/g, '').split('').filter((character) => character.charCodeAt(0) > 31).join('').trim()
}

function parsePositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export default router
