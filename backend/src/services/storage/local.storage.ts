import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, statfs, truncate, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { env } from '../../config/env.js'

const storageRoot = resolve(process.cwd(), env.STORAGE_ROOT)

export const storage = {
  createFileKey(userId: string) {
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'user'
    return `${safeUserId}/${randomUUID()}`
  },

  async writeObject(key: string, stream: Readable, expectedSize: number) {
    const path = resolveStoragePath(key)
    await mkdir(dirname(path), { recursive: true })
    let size = 0
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > expectedSize) callback(new Error('Uploaded file is larger than expected'))
        else callback(null, chunk)
      },
    })
    try {
      await pipeline(stream, sizeGuard, createWriteStream(path, { flags: 'wx' }))
      if (size !== expectedSize) throw new Error('Uploaded file size does not match')
    } catch (error) {
      await unlink(path).catch(() => undefined)
      throw error
    }
  },

  async writeChunk(key: string, stream: Readable, expectedSize: number, offset: number) {
    const path = resolveStoragePath(key)
    await mkdir(dirname(path), { recursive: true })
    const existing = await stat(path).catch((error: unknown) => isMissingFile(error) ? null : Promise.reject(error))
    if ((existing?.size ?? 0) !== offset) throw new Error('Upload chunk offset does not match stored data')

    let size = 0
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > expectedSize) callback(new Error('Uploaded chunk is larger than expected'))
        else callback(null, chunk)
      },
    })
    try {
      await pipeline(stream, sizeGuard, createWriteStream(path, offset === 0 ? { flags: 'w' } : { flags: 'r+', start: offset }))
      if (size !== expectedSize) throw new Error('Uploaded chunk size does not match')
    } catch (error) {
      if (offset === 0) await unlink(path).catch(() => undefined)
      else await truncate(path, offset).catch(() => undefined)
      throw error
    }
  },

  async objectMetadata(key: string) {
    try {
      const result = await stat(resolveStoragePath(key))
      return { size: result.size }
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  },

  async usage() {
    await mkdir(storageRoot, { recursive: true })
    const filesystem = await statfs(storageRoot)
    const blockSize = Number(filesystem.bsize)
    const totalBytes = Number(filesystem.blocks) * blockSize
    const freeBytes = Number(filesystem.bavail) * blockSize
    const usedBytes = totalBytes - Number(filesystem.bfree) * blockSize
    const dataBytes = await directoryBytes(storageRoot)
    return { totalBytes, usedBytes, freeBytes, dataBytes }
  },

  createReadStream(key: string) {
    return createReadStream(resolveStoragePath(key))
  },

  async deleteObject(key: string) {
    try {
      await unlink(resolveStoragePath(key))
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }
  },
}

function resolveStoragePath(key: string) {
  const normalizedKey = key.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedKey || normalizedKey.includes('..') || normalizedKey.startsWith('../') || normalizedKey.startsWith('/')) {
    throw new Error('Invalid storage key')
  }
  const targetPath = resolve(storageRoot, normalizedKey)
  const relativePath = relative(storageRoot, targetPath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Invalid storage key')
  }
  return targetPath
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function directoryBytes(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => isMissingFile(error) ? [] : Promise.reject(error))
  const sizes = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(path, entry.name)
    if (entry.isDirectory()) return directoryBytes(entryPath)
    if (entry.isFile()) return (await stat(entryPath)).size
    return 0
  }))
  return sizes.reduce((total, size) => total + size, 0)
}