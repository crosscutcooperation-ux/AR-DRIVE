import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireActiveUser, requireAuth } from '../middleware/auth.middleware.js'

const router = Router()
const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().cuid().nullable().optional() }).strict()

router.use(requireAuth, requireActiveUser)

router.get('/', async (request, response) => {
  const parentId = typeof request.query.parentId === 'string' ? request.query.parentId : null
  const folders = await prisma.folder.findMany({ where: { ownerId: request.user!.id, parentId, deletedAt: null }, orderBy: { name: 'asc' } })
  response.json({ success: true, data: { folders } })
})

router.get('/:id', async (request, response) => {
  const folder = await ownedFolder(request.params.id, request.user!.id)
  if (!folder) {
    response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
    return
  }
  const [children, files] = await Promise.all([
    prisma.folder.findMany({ where: { ownerId: request.user!.id, parentId: folder.id, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.file.findMany({ where: { ownerId: request.user!.id, folderId: folder.id, deletedAt: null }, orderBy: { name: 'asc' } }),
  ])
  response.json({ success: true, data: { folder, children, files: files.map((file) => ({ ...file, size: file.size.toString() })) } })
})

router.post('/', async (request, response) => {
  const parsed = folderSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Folder details are invalid' } })
    return
  }
  const parentId = parsed.data.parentId ?? null
  if (parentId && !await ownedFolder(parentId, request.user!.id)) {
    response.status(404).json({ success: false, error: { code: 'PARENT_FOLDER_NOT_FOUND', message: 'Parent folder not found' } })
    return
  }
  const folder = await prisma.folder.create({ data: { name: parsed.data.name, parentId, ownerId: request.user!.id } })
  await prisma.activity.create({ data: { userId: request.user!.id, action: 'FOLDER_CREATE', entityType: 'FOLDER', entityId: folder.id } })
  response.status(201).json({ success: true, data: { folder } })
})

router.patch('/:id', async (request, response) => {
  const parsed = folderSchema.partial().safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Folder update is invalid' } })
    return
  }
  const folder = await ownedFolder(request.params.id, request.user!.id)
  if (!folder) {
    response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
    return
  }
  const parentId = parsed.data.parentId === undefined ? folder.parentId : parsed.data.parentId
  if (parentId === folder.id || parentId && await containsFolder(folder.id, parentId)) {
    response.status(409).json({ success: false, error: { code: 'INVALID_FOLDER_MOVE', message: 'A folder cannot be moved into itself or its descendants' } })
    return
  }
  if (parentId && !await ownedFolder(parentId, request.user!.id)) {
    response.status(404).json({ success: false, error: { code: 'PARENT_FOLDER_NOT_FOUND', message: 'Parent folder not found' } })
    return
  }
  const updated = await prisma.folder.update({ where: { id: folder.id }, data: { ...parsed.data, parentId } })
  await prisma.activity.create({ data: { userId: request.user!.id, action: 'FOLDER_RENAME', entityType: 'FOLDER', entityId: folder.id } })
  response.json({ success: true, data: { folder: updated } })
})

router.delete('/:id', async (request, response) => {
  const folder = await ownedFolder(request.params.id, request.user!.id)
  if (!folder) {
    response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
    return
  }
  const [childCount, fileCount] = await Promise.all([
    prisma.folder.count({ where: { parentId: folder.id, deletedAt: null } }),
    prisma.file.count({ where: { folderId: folder.id, deletedAt: null } }),
  ])
  if (childCount > 0 || fileCount > 0) {
    response.status(409).json({ success: false, error: { code: 'FOLDER_NOT_EMPTY', message: 'Move or delete the folder contents first' } })
    return
  }
  await prisma.$transaction([
    prisma.folder.update({ where: { id: folder.id }, data: { deletedAt: new Date() } }),
    prisma.trashItem.create({ data: { userId: request.user!.id, folderId: folder.id, reason: 'user_deleted' } }),
  ])
  response.status(204).send()
})

async function ownedFolder(id: string, ownerId: string) {
  return prisma.folder.findFirst({ where: { id, ownerId, deletedAt: null } })
}

async function containsFolder(folderId: string, possibleAncestorId: string) {
  let currentId: string | null = possibleAncestorId
  const visited = new Set<string>()
  while (currentId && !visited.has(currentId)) {
    if (currentId === folderId) return true
    visited.add(currentId)
    const current: { parentId: string | null } | null = await prisma.folder.findUnique({ where: { id: currentId }, select: { parentId: true } })
    currentId = current?.parentId ?? null
  }
  return false
}

export default router
