import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const storageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../uploads')

export const storage = {
  createFileKey() {
    return randomUUID()
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

  async objectMetadata(key: string) {
    try {
      const result = await stat(resolveStoragePath(key))
      return { size: result.size }
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
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
  const path = resolve(storageRoot, key)
  if (!path.startsWith(`${storageRoot}${sep}`)) throw new Error('Invalid storage key')
  return path
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}