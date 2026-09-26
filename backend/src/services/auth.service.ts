import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { User } from '@prisma/client'
import { env } from '../config/env.js'
import type { AuthTokenPayload } from '../types/auth.js'

const accessTokenMaxAge = 15 * 60 * 1000
const refreshTokenMaxAge = 7 * 24 * 60 * 60 * 1000

export const authCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

export const accessCookie = { ...authCookieOptions, maxAge: accessTokenMaxAge }
export const refreshCookie = { ...authCookieOptions, maxAge: refreshTokenMaxAge }

export const hashPassword = (password: string) => bcrypt.hash(password, 12)
export const comparePassword = (password: string, passwordHash: string) => bcrypt.compare(password, passwordHash)

export const createAccessToken = (user: Pick<User, 'id' | 'role'>) => jwt.sign(
  { sub: user.id, role: user.role, type: 'access' } satisfies AuthTokenPayload,
  env.JWT_SECRET,
  { expiresIn: '15m' },
)

export const createRefreshToken = (user: Pick<User, 'id' | 'role'>) => jwt.sign(
  { sub: user.id, role: user.role, type: 'refresh' } satisfies AuthTokenPayload,
  env.JWT_REFRESH_SECRET,
  { expiresIn: '7d' },
)

export const verifyAccessToken = (token: string) => verifyToken(token, env.JWT_SECRET, 'access')
export const verifyRefreshToken = (token: string) => verifyToken(token, env.JWT_REFRESH_SECRET, 'refresh')

function verifyToken(token: string, secret: string, type: AuthTokenPayload['type']): AuthTokenPayload {
  const payload = jwt.verify(token, secret)
  if (typeof payload === 'string' || payload.type !== type || typeof payload.sub !== 'string' || (payload.role !== 'ADMIN' && payload.role !== 'USER')) {
    throw new Error('Invalid token payload')
  }
  return { sub: payload.sub, role: payload.role, type }
}

export const toPublicUser = (user: User, actualStorageUsed = user.storageUsed) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatarUrl: user.avatarUrl,
  storageQuota: user.storageQuota.toString(),
  storageUsed: actualStorageUsed.toString(),
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLoginAt: user.lastLoginAt,
})
