import { Router } from 'express'
import { ZipArchive, type ArchiverError } from 'archiver'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireActiveUser, requireAuth } from '../middleware/auth.middleware.js'
import { storage } from '../services/storage/local.storage.js'
import { resolveFileAccess, resolveFolderAccess } from '../services/sharing.service.js'

const router = Router()
const permissionSchema = z.enum(['VIEW', 'EDIT'])

router.use(requireAuth, requireActiveUser)

router.get('/storage/usage', async (_request, response) => {
  response.json({ success: true, data: { storage: await storage.usage() } })
})

router.get('/downloads/archive', async (request, response) => {
  const fileIds = parseIdList(request.query.fileIds)
  const folderIds = parseIdList(request.query.folderIds)
  if (!fileIds.length && !folderIds.length || fileIds.length + folderIds.length > 100) {
    response.status(400).json({ success: false, error: { code: 'INVALID_ARCHIVE_SELECTION', message: 'Select between 1 and 100 files or folders to download' } })
    return
  }

  const entries: Array<{ storageKey: string; path: string }> = []
  const seenFileIds = new Set<string>()
  for (const fileId of fileIds) {
    const access = await resolveFileAccess(request.user!.id, fileId)
    if (!access) {
      response.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'A selected file is not available' } })
      return
    }
    seenFileIds.add(access.file.id)
    entries.push({ storageKey: access.file.storageKey, path: safeArchivePath(access.file.originalName) })
  }

  for (const folderId of folderIds) {
    const access = await resolveFolderAccess(request.user!.id, folderId)
    if (!access) {
      response.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'A selected folder is not available' } })
      return
    }
    const rootPath = safeArchivePath(access.folder.name)
    const pending = [{ id: access.folder.id, path: rootPath }]
    const visited = new Set<string>()
    while (pending.length) {
      const current = pending.shift()!
      if (visited.has(current.id)) continue
      visited.add(current.id)
      const [children, filesInFolder] = await Promise.all([
        prisma.folder.findMany({ where: { ownerId: access.ownerId, parentId: current.id, deletedAt: null }, select: { id: true, name: true } }),
        prisma.file.findMany({ where: { ownerId: access.ownerId, folderId: current.id, deletedAt: null }, select: { id: true, name: true, originalName: true, storageKey: true } }),
      ])
      for (const child of children) pending.push({ id: child.id, path: `${current.path}/${safeArchivePath(child.name)}` })
      for (const file of filesInFolder) {
        if (seenFileIds.has(file.id)) continue
        seenFileIds.add(file.id)
        entries.push({ storageKey: file.storageKey, path: `${current.path}/${safeArchivePath(file.originalName || file.name)}` })
      }
    }
  }

  if (!entries.length) {
    response.status(404).json({ success: false, error: { code: 'EMPTY_ARCHIVE', message: 'The selected folders contain no downloadable files' } })
    return
  }

  const archive = new ZipArchive({ zlib: { level: 6 } })
  const uniquePaths = makeUniqueArchivePaths()
  archive.on('error', (error: ArchiverError) => response.destroy(error))
  archive.on('warning', (error: ArchiverError) => {
    if (error.code !== 'ENOENT') response.destroy(error)
  })
  response.attachment('AR-DRIVE-download.zip')
  archive.pipe(response)
  for (const entry of entries) archive.append(storage.createReadStream(entry.storageKey), { name: uniquePaths(entry.path) })
  await archive.finalize()
})

router.get('/search', async (request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : ''
  if (query.length < 2) {
    response.json({ success: true, data: { files: [], folders: [] } })
    return
  }
  const [fileCandidates, folderCandidates] = await Promise.all([
    prisma.file.findMany({ where: { name: { contains: query }, deletedAt: null }, take: 200, orderBy: { updatedAt: 'desc' } }),
    prisma.folder.findMany({ where: { name: { contains: query }, deletedAt: null }, take: 200, orderBy: { updatedAt: 'desc' } }),
  ])
  const [files, folders] = await Promise.all([
    Promise.all(fileCandidates.map(async (file) => (await resolveFileAccess(request.user!.id, file.id))?.file ?? null)),
    Promise.all(folderCandidates.map(async (folder) => (await resolveFolderAccess(request.user!.id, folder.id))?.folder ?? null)),
  ])
  response.json({ success: true, data: { files: files.filter((file): file is NonNullable<typeof file> => file !== null).map((file) => ({ ...file, size: file.size.toString(), type: 'file' })), folders: folders.filter((folder): folder is NonNullable<typeof folder> => folder !== null).map((folder) => ({ ...folder, type: 'folder' })) } })
})

router.get('/recent', async (request, response) => {
  const activities = await prisma.activity.findMany({ where: { userId: request.user!.id, entityType: 'FILE' }, orderBy: { createdAt: 'desc' }, take: 50 })
  const latestActivity = new Map<string, Date>()
  for (const activity of activities) {
    if (!latestActivity.has(activity.entityId)) latestActivity.set(activity.entityId, activity.createdAt)
  }
  const files = await prisma.file.findMany({ where: { id: { in: [...latestActivity.keys()] }, ownerId: request.user!.id, deletedAt: null } })
  const byId = new Map(files.map((file) => [file.id, file]))
  const recent = [...latestActivity].flatMap(([fileId, lastActivity]) => {
    const file = byId.get(fileId)
    return file ? [{ ...file, size: file.size.toString(), lastActivity }] : []
  })
  response.json({ success: true, data: { files: recent } })
})

router.get('/starred', async (request, response) => {
  const items = await prisma.starredItem.findMany({ where: { userId: request.user!.id }, include: { file: true, folder: true }, orderBy: { createdAt: 'desc' } })
  const files = items.filter((item) => item.file).map((item) => ({ ...item.file!, size: item.file!.size.toString() }))
  const folders = items.filter((item) => item.folder).map((item) => item.folder!)
  response.json({ success: true, data: { files, folders } })
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
    const parentValid = !file.folderId || await prisma.folder.findFirst({ where: { id: file.folderId, ownerId: request.user!.id, deletedAt: null }, select: { id: true } })
    await prisma.file.update({ where: { id: file.id }, data: { deletedAt: null, folderId: parentValid ? file.folderId : null } })
    await prisma.activity.create({ data: { userId: request.user!.id, action: 'FILE_RESTORE', entityType: 'FILE', entityId: file.id } })
    response.json({ success: true, data: { restored: { type: 'file', id: file.id } } })
    return
  }
  const folder = await prisma.folder.findFirst({ where: { id: request.params.id, ownerId: request.user!.id, deletedAt: { not: null } } })
  if (!folder) {
    response.status(404).json({ success: false, error: { code: 'TRASH_ITEM_NOT_FOUND', message: 'Trash item not found' } })
    return
  }

  const folderIds = await collectDeletedFolderIds(folder.id, request.user!.id)
  const parentValid = !folder.parentId || await prisma.folder.findFirst({ where: { id: folder.parentId, ownerId: request.user!.id, deletedAt: null } })
  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: folderIds } }, data: { deletedAt: null } }),
    prisma.folder.update({ where: { id: folder.id }, data: { parentId: parentValid ? folder.parentId : null } }),
    prisma.file.updateMany({ where: { ownerId: request.user!.id, folderId: { in: folderIds }, deletedAt: { not: null } }, data: { deletedAt: null } }),
  ])

  response.json({ success: true, data: { restored: { type: 'folder', id: folder.id } } })
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

  const folderIds = await collectDeletedFolderIds(folder.id, request.user!.id)
  const files = await prisma.file.findMany({ where: { ownerId: request.user!.id, folderId: { in: folderIds }, deletedAt: { not: null } } })

  await Promise.all(files.map((file) => storage.deleteObject(file.storageKey)))
  await prisma.$transaction([
    prisma.file.deleteMany({ where: { id: { in: files.map((file) => file.id) } } }),
    prisma.folder.deleteMany({ where: { id: { in: folderIds } } }),
    prisma.user.update({ where: { id: request.user!.id }, data: { storageUsed: { decrement: files.reduce((sum, file) => sum + file.size, 0n) } } }),
  ])

  response.status(204).send()
})

router.get('/shares', async (request, response) => {
  const shares = await prisma.share.findMany({
    where: {
      sharedWithUserId: request.user!.id,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { file: true, folder: true, owner: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  })

  const files = shares
    .filter((share) => share.file && !share.file.deletedAt)
    .map((share) => ({
      ...share.file!,
      size: share.file!.size.toString(),
      shareId: share.id,
      permission: share.permission,
      sharedBy: share.owner,
    }))

  const folders = shares
    .filter((share) => share.folder && !share.folder.deletedAt)
    .map((share) => ({
      ...share.folder!,
      shareId: share.id,
      permission: share.permission,
      sharedBy: share.owner,
    }))

  response.json({ success: true, data: { files, folders } })
})

router.get('/shares/owned', async (request, response) => {
  const shares = await prisma.share.findMany({
    where: { ownerId: request.user!.id },
    include: {
      file: { select: { id: true, name: true } },
      folder: { select: { id: true, name: true } },
      sharedWithUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  response.json({ success: true, data: { shares } })
})

router.post('/shares', async (request, response) => {
  const parsed = z.object({ fileId: z.string().cuid().optional(), folderId: z.string().cuid().optional(), sharedWithUserId: z.string().cuid().optional(), sharedWithEmail: z.string().trim().email().transform((value) => value.toLowerCase()).optional(), permission: permissionSchema, expiresAt: z.coerce.date().optional() }).strict().safeParse(request.body)
  if (!parsed.success || Boolean(parsed.data?.fileId) === Boolean(parsed.data?.folderId) || Boolean(parsed.data?.sharedWithUserId) === Boolean(parsed.data?.sharedWithEmail)) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Share target and recipient are required' } })
    return
  }
  if (parsed.data.expiresAt && parsed.data.expiresAt <= new Date()) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Share expiry must be in the future' } })
    return
  }
  const target = parsed.data.fileId ? await prisma.file.findFirst({ where: { id: parsed.data.fileId, ownerId: request.user!.id, deletedAt: null } }) : await prisma.folder.findFirst({ where: { id: parsed.data.folderId, ownerId: request.user!.id, deletedAt: null } })
  const recipient = await prisma.user.findFirst({ where: { ...(parsed.data.sharedWithUserId ? { id: parsed.data.sharedWithUserId } : { email: parsed.data.sharedWithEmail }), isActive: true } })
  if (!target || !recipient || recipient.id === request.user!.id) {
    response.status(404).json({ success: false, error: { code: 'SHARE_TARGET_NOT_FOUND', message: 'Share target or recipient not found' } })
    return
  }
  const duplicate = await prisma.share.findFirst({
    where: {
      ownerId: request.user!.id,
      sharedWithUserId: recipient.id,
      ...(parsed.data.fileId ? { fileId: parsed.data.fileId } : { folderId: parsed.data.folderId }),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })
  if (duplicate) {
    response.status(409).json({ success: false, error: { code: 'SHARE_ALREADY_EXISTS', message: 'This item is already shared with that user' } })
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
  const share = await prisma.share.findFirst({ where: { id: request.params.id, OR: [{ ownerId: request.user!.id }, { sharedWithUserId: request.user!.id }] } })
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

async function collectDeletedFolderIds(rootId: string, ownerId: string): Promise<string[]> {
  const folderIds = new Set<string>([rootId])
  const queue = [rootId]

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const children = await prisma.folder.findMany({ where: { ownerId, deletedAt: { not: null }, parentId: currentId } })
    for (const child of children) {
      if (!folderIds.has(child.id)) {
        folderIds.add(child.id)
        queue.push(child.id)
      }
    }
  }

  return [...folderIds]
}

function parseIdList(value: unknown) {
  if (typeof value !== 'string') return []
  return [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))]
}

function safeArchivePath(value: string) {
  return value.replace(/[\\/]/g, '_').split('').filter((character) => character.charCodeAt(0) > 31).join('').trim() || 'unnamed'
}

function makeUniqueArchivePaths() {
  const counts = new Map<string, number>()
  return (path: string) => {
    const count = counts.get(path) ?? 0
    counts.set(path, count + 1)
    if (count === 0) return path
    const separator = path.lastIndexOf('.')
    const extensionAt = separator > path.lastIndexOf('/') ? separator : path.length
    return `${path.slice(0, extensionAt)} (${count + 1})${path.slice(extensionAt)}`
  }
}

export default router
