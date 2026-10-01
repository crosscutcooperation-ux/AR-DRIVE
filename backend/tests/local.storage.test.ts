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

test('local storage appends exact chunks at the requested offset', async () => {
  const key = `tests/${Date.now()}-chunk-check`
  await storage.writeChunk(key, Readable.from(Buffer.from('hello ')), 6, 0)
  await storage.writeChunk(key, Readable.from(Buffer.from('world')), 5, 6)

  assert.deepEqual(await storage.objectMetadata(key), { size: 11 })
  await storage.deleteObject(key)
})

test('local storage rejects chunk offsets that do not match stored data', async () => {
  const key = `tests/${Date.now()}-chunk-offset-check`
  await storage.writeChunk(key, Readable.from(Buffer.from('hello')), 5, 0)

  await assert.rejects(() => storage.writeChunk(key, Readable.from(Buffer.from('!')), 1, 3), /offset does not match/)
  await storage.deleteObject(key)
})

test('local storage removes an interrupted chunk without losing earlier chunks', async () => {
  const key = `tests/${Date.now()}-interrupted-chunk-check`
  await storage.writeChunk(key, Readable.from(Buffer.from('safe')), 4, 0)
  const interrupted = Readable.from((async function* () {
    yield Buffer.from('par')
    throw new Error('connection reset')
  })())

  await assert.rejects(() => storage.writeChunk(key, interrupted, 5, 4), /connection reset/)
  assert.deepEqual(await storage.objectMetadata(key), { size: 4 })
  await storage.deleteObject(key)
})