import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireActiveUser, requireAuth } from '../middleware/auth.middleware.js'
import { resolveFolderAccess } from '../services/sharing.service.js'

const router = Router()
const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().cuid().nullable().optional() }).strict()

router.use(requireAuth, requireActiveUser)

router.get('/', async (request, response) => {
  const parentId = typeof request.query.parentId === 'string' ? request.query.parentId : null
  const parentAccess = parentId ? await resolveFolderAccess(request.user!.id, parentId) : null
  if (parentId && !parentAccess) {
    response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
    return
  }
  const folders = await prisma.folder.findMany({ where: { ownerId: parentAccess?.ownerId ?? request.user!.id, parentId, deletedAt: null }, orderBy: { name: 'asc' } })
  response.json({ success: true, data: { folders } })
})

router.get('/:id', async (request, response) => {
  const access = await resolveFolderAccess(request.user!.id, request.params.id)
  if (!access) {
    response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
    return
  }
  const folder = access.folder
  const [children, files] = await Promise.all([
    prisma.folder.findMany({ where: { ownerId: access.ownerId, parentId: folder.id, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.file.findMany({ where: { ownerId: access.ownerId, folderId: folder.id, deletedAt: null }, orderBy: { name: 'asc' } }),
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
  let ownerId = request.user!.id
  if (parentId) {
    const parentAccess = await resolveFolderAccess(request.user!.id, parentId)
    if (!parentAccess) {
      response.status(404).json({ success: false, error: { code: 'PARENT_FOLDER_NOT_FOUND', message: 'Parent folder not found' } })
      return
    }
    if (parentAccess.permission === 'VIEW') {
      response.status(403).json({ success: false, error: { code: 'SHARE_READ_ONLY', message: 'This shared folder is read-only' } })
      return
    }
    ownerId = parentAccess.ownerId
  }
  const folder = await prisma.folder.create({ data: { name: parsed.data.name, parentId, ownerId } })
  await prisma.activity.create({ data: { userId: request.user!.id, action: 'FOLDER_CREATE', entityType: 'FOLDER', entityId: folder.id } })
  response.status(201).json({ success: true, data: { folder } })
})

router.patch('/:id', async (request, response) => {
  const parsed = folderSchema.partial().safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Folder update is invalid' } })
    return
  }
  const access = await resolveFolderAccess(request.user!.id, request.params.id)
  if (!access) {
    response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
    return
  }
  if (access.permission === 'VIEW') {
    response.status(403).json({ success: false, error: { code: 'SHARE_READ_ONLY', message: 'This shared folder is read-only' } })
    return
  }
  const folder = access.folder
  const parentId = parsed.data.parentId === undefined ? folder.parentId : parsed.data.parentId
  if (parentId === folder.id || parentId && await containsFolder(folder.id, parentId)) {
    response.status(409).json({ success: false, error: { code: 'INVALID_FOLDER_MOVE', message: 'A folder cannot be moved into itself or its descendants' } })
    return
  }
  if (parentId) {
    const parentAccess = await resolveFolderAccess(request.user!.id, parentId)
    if (!parentAccess || parentAccess.ownerId !== access.ownerId) {
      response.status(404).json({ success: false, error: { code: 'PARENT_FOLDER_NOT_FOUND', message: 'Parent folder not found' } })
      return
    }
    if (parentAccess.permission === 'VIEW') {
      response.status(403).json({ success: false, error: { code: 'SHARE_READ_ONLY', message: 'The destination folder is read-only' } })
      return
    }
  } else if (access.permission !== 'OWNER') {
    response.status(403).json({ success: false, error: { code: 'SHARE_OWNER_REQUIRED', message: 'Only the owner can move a shared folder to My Drive' } })
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

  const folderIds = await collectFolderIds(folder.id, request.user!.id)
  const files = await prisma.file.findMany({ where: { ownerId: request.user!.id, folderId: { in: folderIds }, deletedAt: null } })

  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: folderIds } }, data: { deletedAt: new Date() } }),
    prisma.file.updateMany({ where: { id: { in: files.map((file) => file.id) } }, data: { deletedAt: new Date() } }),
    prisma.trashItem.createMany({
      data: [
        { userId: request.user!.id, folderId: folder.id, reason: 'user_deleted' },
        ...files.map((file) => ({ userId: request.user!.id, fileId: file.id, reason: 'user_deleted' })),
      ],
    }),
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

async function collectFolderIds(rootId: string, ownerId: string): Promise<string[]> {
  const ids = new Set<string>([rootId])
  const queue = [rootId]

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const children = await prisma.folder.findMany({ where: { ownerId, deletedAt: null, parentId: currentId } })
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id)
        queue.push(child.id)
      }
    }
  }

  return [...ids]
}

export default router
