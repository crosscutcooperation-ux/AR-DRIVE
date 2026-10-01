import { prisma } from '../config/prisma.js'

export type ResourcePermission = 'OWNER' | 'VIEW' | 'EDIT'

export async function resolveFolderAccess(userId: string, folderId: string) {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, deletedAt: null } })
  if (!folder) return null
  if (folder.ownerId === userId) return { folder, ownerId: folder.ownerId, permission: 'OWNER' as const }

  const ancestorIds = await getActiveAncestorIds(folder.id, folder.parentId, folder.ownerId)
  const shares = await prisma.share.findMany({
    where: {
      ownerId: folder.ownerId,
      sharedWithUserId: userId,
      folderId: { in: ancestorIds },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { folderId: true, permission: true },
  })
  if (shares.length === 0) return null

  const permission = permissionAtNearestFolder(shares, ancestorIds)

  return {
    folder,
    ownerId: folder.ownerId,
    permission,
  }
}

export async function resolveFileAccess(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({ where: { id: fileId, deletedAt: null } })
  if (!file) return null
  if (file.ownerId === userId) return { file, ownerId: file.ownerId, permission: 'OWNER' as const }

  let ancestorIds: string[] = []
  if (file.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: file.folderId, ownerId: file.ownerId, deletedAt: null },
      select: { parentId: true },
    })
    if (!folder) return null
    ancestorIds = await getActiveAncestorIds(file.folderId, folder.parentId, file.ownerId)
  }
  const shares = await prisma.share.findMany({
    where: {
      ownerId: file.ownerId,
      sharedWithUserId: userId,
      OR: [{ fileId: file.id }, { folderId: { in: ancestorIds } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
    select: { fileId: true, folderId: true, permission: true },
  })
  if (shares.length === 0) return null

  const directShares = shares.filter((share) => share.fileId === file.id)
  const permission = directShares.length > 0
    ? directShares.some((share) => share.permission === 'EDIT') ? 'EDIT' as const : 'VIEW' as const
    : permissionAtNearestFolder(shares, ancestorIds)

  return {
    file,
    ownerId: file.ownerId,
    permission,
  }
}

async function getActiveAncestorIds(folderId: string, parentId: string | null, ownerId: string) {
  const ids = [folderId]
  const visited = new Set(ids)
  let currentId = parentId

  while (currentId && !visited.has(currentId)) {
    const parent = await prisma.folder.findFirst({
      where: { id: currentId, ownerId, deletedAt: null },
      select: { id: true, parentId: true },
    })
    if (!parent) break
    visited.add(parent.id)
    ids.push(parent.id)
    currentId = parent.parentId
  }

  return ids
}

function permissionAtNearestFolder(shares: Array<{ folderId: string | null; permission: 'VIEW' | 'EDIT' }>, ancestorIds: string[]) {
  for (const ancestorId of ancestorIds) {
    const matchingShares = shares.filter((share) => share.folderId === ancestorId)
    if (matchingShares.length > 0) {
      return matchingShares.some((share) => share.permission === 'EDIT') ? 'EDIT' as const : 'VIEW' as const
    }
  }
  return 'VIEW' as const
}