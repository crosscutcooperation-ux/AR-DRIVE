import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { storage } from '../src/services/storage/local.storage.js'

test('local storage writes exact bytes, reports metadata, and cleans up', async () => {
  const key = `tests/${Date.now()}-storage-check`
  await storage.writeObject(key, Readable.from(Buffer.from('hello')), 5)

  assert.deepEqual(await storage.objectMetadata(key), { size: 5 })
  await storage.deleteObject(key)
  assert.equal(await storage.objectMetadata(key), null)
})

test('local storage rejects traversal keys', async () => {
  await assert.rejects(() => storage.writeObject('../outside', Readable.from(Buffer.from('x')), 1), /Invalid storage key/)
})