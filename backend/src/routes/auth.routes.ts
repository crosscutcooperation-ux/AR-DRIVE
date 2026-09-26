import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireAuth, requireActiveUser } from '../middleware/auth.middleware.js'
import {
  accessCookie,
  authCookieOptions,
  comparePassword,
  createAccessToken,
  createRefreshToken,
  hashPassword,
  refreshCookie,
  toPublicUser,
  verifyRefreshToken,
} from '../services/auth.service.js'

const router = Router()
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false })
const credentialsSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), password: z.string().min(8).max(128) })
const registerSchema = credentialsSchema.extend({ name: z.string().trim().min(2).max(80) })

router.post('/register', authLimiter, async (request, response) => {
  const parsed = registerSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Name, email, and a valid password are required' } })
    return
  }
  const { name, email, password } = parsed.data
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    response.status(409).json({ success: false, error: { code: 'EMAIL_IN_USE', message: 'An account with this email already exists' } })
    return
  }
  const user = await prisma.user.create({ data: { name, email, passwordHash: await hashPassword(password) } })
  setAuthCookies(response, user)
  response.status(201).json({ success: true, data: { user: toPublicUser(user) } })
})

router.post('/login', authLimiter, async (request, response) => {
  const parsed = credentialsSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid email and password are required' } })
    return
  }
  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.isActive || !(await comparePassword(password, user.passwordHash))) {
    response.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } })
    return
  }
  const updatedUser = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  await prisma.activity.create({ data: { userId: user.id, action: 'LOGIN', entityType: 'USER', entityId: user.id } })
  setAuthCookies(response, updatedUser)
  response.json({ success: true, data: { user: toPublicUser(updatedUser) } })
})

router.post('/refresh', async (request, response) => {
  const token = readCookie(request, 'refreshToken')
  if (!token) {
    response.status(401).json({ success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'A refresh token is required' } })
    return
  }
  try {
    const payload = verifyRefreshToken(token)
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user?.isActive) throw new Error('Inactive user')
    setAuthCookies(response, user)
    response.json({ success: true, data: { user: toPublicUser(user) } })
  } catch {
    response.status(401).json({ success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'Your session has expired' } })
  }
})

router.post('/logout', requireAuth, requireActiveUser, async (request, response) => {
  await prisma.activity.create({ data: { userId: request.user!.id, action: 'LOGOUT', entityType: 'USER', entityId: request.user!.id } })
  response.clearCookie('accessToken', authCookieOptions)
  response.clearCookie('refreshToken', authCookieOptions)
  response.status(204).send()
})

router.get('/me', requireAuth, requireActiveUser, async (request, response) => {
  const user = await prisma.user.findUnique({ where: { id: request.user!.id } })
  if (!user) {
    response.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
    return
  }
  const usage = await prisma.file.aggregate({ where: { ownerId: user.id }, _sum: { size: true } })
  response.json({ success: true, data: { user: toPublicUser(user, usage._sum.size ?? 0n) } })
})

function setAuthCookies(response: Response, user: { id: string; role: 'ADMIN' | 'USER' }) {
  response.cookie('accessToken', createAccessToken(user), accessCookie)
  response.cookie('refreshToken', createRefreshToken(user), refreshCookie)
}

function readCookie(request: Request, name: string) {
  const cookies = request.header('cookie')?.split(';') ?? []
  const cookie = cookies.find((value) => value.trim().startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : undefined
}

export default router
