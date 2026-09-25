import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireActiveUser, requireAuth } from '../middleware/auth.middleware.js'
import { storage } from '../services/storage/local.storage.js'

const router = Router()
const permissionSchema = z.enum(['VIEW', 'EDIT'])

router.use(requireAuth, requireActiveUser)

router.get('/search', async (request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : ''
  if (query.length < 2) {
    response.json({ success: true, data: { files: [], folders: [] } })
    return
  }
  const [files, folders] = await Promise.all([
    prisma.file.findMany({ where: { ownerId: request.user!.id, deletedAt: null, name: { contains: query } }, take: 50, orderBy: { updatedAt: 'desc' } }),
    prisma.folder.findMany({ where: { ownerId: request.user!.id, deletedAt: null, name: { contains: query } }, take: 50, orderBy: { updatedAt: 'desc' } }),
  ])
  response.json({ success: true, data: { files: files.map((file) => ({ ...file, size: file.size.toString(), type: 'file' })), folders: folders.map((folder) => ({ ...folder, type: 'folder' })) } })
})

router.get('/recent', async (request, response) => {
  const activities = await prisma.activity.findMany({ where: { userId: request.user!.id, entityType: 'FILE' }, orderBy: { createdAt: 'desc' }, take: 50 })
  const files = await prisma.file.findMany({ where: { id: { in: activities.map((activity) => activity.entityId) }, ownerId: request.user!.id, deletedAt: null } })
  const byId = new Map(files.map((file) => [file.id, file]))
  const recent = activities.flatMap((activity) => {
    const file = byId.get(activity.entityId)
    return file ? [{ ...file, size: file.size.toString(), lastActivity: activity.createdAt }] : []
  })
  response.json({ success: true, data: { files: recent } })
})

router.get('/starred', async (request, response) => {
  const items = await prisma.starredItem.findMany({ where: { userId: request.user!.id }, include: { file: true, folder: true }, orderBy: { createdAt: 'desc' } })
  response.json({ success: true, data: { items: items.map((item) => ({ ...item, file: item.file ? { ...item.file, size: item.file.size.toString() } : null })) } })
})

router.post('/starred/:id', async (request, response) => {
  const target = await resolveOwnedTarget(request.params.id, request.user!.id)
  if (!target) {
    response.status(404).json({ success: false, error: { code: 'ITEM_NOT_FOUND', message: 'File or folder not found' } })
    return
  }
  const item = await prisma.starredItem.create({ data: { userId: request.user!.id, ...(target.type === 'file' ? { fileId: target.id } : { folderId: target.id }) } })
  response.status(201).json({ success: true, data: { item } })
})

router.delete('/starred/:id', async (request, response) => {
  const [fileStar, folderStar] = await Promise.all([
    prisma.starredItem.findFirst({ where: { userId: request.user!.id, fileId: request.params.id } }),
    prisma.starredItem.findFirst({ where: { userId: request.user!.id, folderId: request.params.id } }),
  ])
  if (!fileStar && !folderStar) {
    response.status(404).json({ success: false, error: { code: 'STARRED_ITEM_NOT_FOUND', message: 'Starred item not found' } })
    return
  }
  await prisma.starredItem.delete({ where: { id: (fileStar ?? folderStar)!.id } })
  response.status(204).send()
})

router.get('/trash', async (request, response) => {
  const [files, folders] = await Promise.all([
    prisma.file.findMany({ where: { ownerId: request.user!.id, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    prisma.folder.findMany({ where: { ownerId: request.user!.id, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
  ])
  response.json({ success: true, data: { files: files.map((file) => ({ ...file, size: file.size.toString() })), folders } })
})

router.post('/trash/:id/restore', async (request, response) => {
  const file = await prisma.file.findFirst({ where: { id: request.params.id, ownerId: request.user!.id, deletedAt: { not: null } } })
  if (file) {
    await prisma.file.update({ where: { id: file.id }, data: { deletedAt: null } })
    await prisma.activity.create({ data: { userId: request.user!.id, action: 'FILE_RESTORE', entityType: 'FILE', entityId: file.id } })
    response.json({ success: true, data: { restored: { type: 'file', id: file.id } } })
    return
  }
  const folder = await prisma.folder.findFirst({ where: { id: request.params.id, ownerId: request.user!.id, deletedAt: { not: null } } })
  if (!folder) {
    response.status(404).json({ success: false, error: { code: 'TRASH_ITEM_NOT_FOUND', message: 'Trash item not found' } })
    return
  }
  const parentValid = !folder.parentId || await prisma.folder.findFirst({ where: { id: folder.parentId, ownerId: request.user!.id, deletedAt: null } })
  const restored = await prisma.folder.update({ where: { id: folder.id }, data: { deletedAt: null, parentId: parentValid ? folder.parentId : null } })
  response.json({ success: true, data: { restored: { type: 'folder', id: restored.id } } })
})

router.delete('/trash/:id', async (request, response) => {
  const file = await prisma.file.findFirst({ where: { id: request.params.id, ownerId: request.user!.id, deletedAt: { not: null } } })
  if (file) {
    await storage.deleteObject(file.storageKey)
    await prisma.$transaction([
      prisma.file.delete({ where: { id: file.id } }),
      prisma.user.update({ where: { id: request.user!.id }, data: { storageUsed: { decrement: file.size } } }),
    ])
    response.status(204).send()
    return
  }
  const folder = await prisma.folder.findFirst({ where: { id: request.params.id, ownerId: request.user!.id, deletedAt: { not: null } } })
  if (!folder) {
    response.status(404).json({ success: false, error: { code: 'TRASH_ITEM_NOT_FOUND', message: 'Trash item not found' } })
    return
  }
  const [childCount, fileCount] = await Promise.all([
    prisma.folder.count({ where: { parentId: folder.id, deletedAt: null } }),
    prisma.file.count({ where: { folderId: folder.id, deletedAt: null } }),
  ])
  if (childCount || fileCount) {
    response.status(409).json({ success: false, error: { code: 'FOLDER_NOT_EMPTY', message: 'Folder contents must be permanently deleted first' } })
    return
  }
  await prisma.folder.delete({ where: { id: folder.id } })
  response.status(204).send()
})

router.get('/shares', async (request, response) => {
  const shares = await prisma.share.findMany({ where: { sharedWithUserId: request.user!.id }, include: { file: true, folder: true, owner: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' } })
  response.json({ success: true, data: { shares } })
})

router.post('/shares', async (request, response) => {
  const parsed = z.object({ fileId: z.string().cuid().optional(), folderId: z.string().cuid().optional(), sharedWithUserId: z.string().cuid(), permission: permissionSchema, expiresAt: z.coerce.date().optional() }).strict().safeParse(request.body)
  if (!parsed.success || Boolean(parsed.data?.fileId) === Boolean(parsed.data?.folderId)) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Share must target exactly one file or folder' } })
    return
  }
  const target = parsed.data.fileId ? await prisma.file.findFirst({ where: { id: parsed.data.fileId, ownerId: request.user!.id, deletedAt: null } }) : await prisma.folder.findFirst({ where: { id: parsed.data.folderId, ownerId: request.user!.id, deletedAt: null } })
  const recipient = await prisma.user.findFirst({ where: { id: parsed.data.sharedWithUserId, isActive: true } })
  if (!target || !recipient || recipient.id === request.user!.id) {
    response.status(404).json({ success: false, error: { code: 'SHARE_TARGET_NOT_FOUND', message: 'Share target or recipient not found' } })
    return
  }
  const share = await prisma.share.create({ data: { ownerId: request.user!.id, sharedWithUserId: recipient.id, permission: parsed.data.permission, expiresAt: parsed.data.expiresAt, ...(parsed.data.fileId ? { fileId: parsed.data.fileId } : { folderId: parsed.data.folderId }) } })
  await prisma.activity.create({ data: { userId: request.user!.id, action: 'SHARE_CREATED', entityType: 'SHARE', entityId: share.id } })
  response.status(201).json({ success: true, data: { share } })
})

router.patch('/shares/:id', async (request, response) => {
  const parsed = z.object({ permission: permissionSchema, expiresAt: z.coerce.date().nullable().optional() }).strict().safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Share update is invalid' } })
    return
  }
  const share = await prisma.share.findFirst({ where: { id: request.params.id, ownerId: request.user!.id } })
  if (!share) {
    response.status(404).json({ success: false, error: { code: 'SHARE_NOT_FOUND', message: 'Share not found' } })
    return
  }
  const updated = await prisma.share.update({ where: { id: share.id }, data: parsed.data })
  response.json({ success: true, data: { share: updated } })
})

router.delete('/shares/:id', async (request, response) => {
  const share = await prisma.share.findFirst({ where: { id: request.params.id, ownerId: request.user!.id } })
  if (!share) {
    response.status(404).json({ success: false, error: { code: 'SHARE_NOT_FOUND', message: 'Share not found' } })
    return
  }
  await prisma.share.delete({ where: { id: share.id } })
  await prisma.activity.create({ data: { userId: request.user!.id, action: 'SHARE_REMOVED', entityType: 'SHARE', entityId: share.id } })
  response.status(204).send()
})

async function resolveOwnedTarget(id: string, ownerId: string) {
  const file = await prisma.file.findFirst({ where: { id, ownerId, deletedAt: null }, select: { id: true } })
  if (file) return { type: 'file' as const, id: file.id }
  const folder = await prisma.folder.findFirst({ where: { id, ownerId, deletedAt: null }, select: { id: true } })
  return folder ? { type: 'folder' as const, id: folder.id } : null
}

export default router
