import assert from 'node:assert/strict'
import test from 'node:test'
import { comparePassword, createAccessToken, createRefreshToken, hashPassword, verifyAccessToken, verifyRefreshToken } from '../src/services/auth.service.js'

const user = { id: 'test-user', role: 'USER' as const }

test('password hashes round-trip without exposing the original password', async () => {
  const password = 'correct horse battery staple'
  const hash = await hashPassword(password)

  assert.notEqual(hash, password)
  assert.equal(await comparePassword(password, hash), true)
  assert.equal(await comparePassword('wrong password', hash), false)
})

test('access and refresh tokens cannot be used interchangeably', () => {
  const accessToken = createAccessToken(user)
  const refreshToken = createRefreshToken(user)

  assert.equal(verifyAccessToken(accessToken).sub, user.id)
  assert.equal(verifyRefreshToken(refreshToken).sub, user.id)
  assert.throws(() => verifyRefreshToken(accessToken))
  assert.throws(() => verifyAccessToken(refreshToken))
})