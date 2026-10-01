import { prisma } from '../config/prisma.js'
import { storage } from './storage/local.storage.js'

export async function cleanupExpiredUploadSessions() {
  try {
    const expiredSessions = await prisma.uploadSession.findMany({
      where: { expiresAt: { lt: new Date() } },
      select: { id: true, storageKey: true },
    })

    for (const session of expiredSessions) {
      try {
        await storage.deleteObject(session.storageKey)
        await prisma.uploadSession.deleteMany({ where: { id: session.id, expiresAt: { lt: new Date() } } })
      } catch (error) {
        console.error('Failed to clean an expired upload session', error)
      }
    }
  } catch (error) {
    console.error('Failed to scan for expired upload sessions', error)
  }
}