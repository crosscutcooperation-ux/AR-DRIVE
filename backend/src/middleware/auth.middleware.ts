import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../config/prisma.js'
import { verifyAccessToken } from '../services/auth.service.js'

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '') ?? readCookie(request, 'accessToken')
  if (!token) {
    response.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } })
    return
  }

  try {
    const payload = verifyAccessToken(token)
    request.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    response.status(401).json({ success: false, error: { code: 'INVALID_ACCESS_TOKEN', message: 'Authentication is required' } })
  }
}

export async function requireActiveUser(request: Request, response: Response, next: NextFunction) {
  if (!request.user) {
    response.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } })
    return
  }
  const user = await prisma.user.findUnique({ where: { id: request.user.id } })
  if (!user?.isActive) {
    response.status(403).json({ success: false, error: { code: 'USER_INACTIVE', message: 'This account is inactive' } })
    return
  }
  request.user.role = user.role
  next()
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (request.user?.role !== 'ADMIN') {
    response.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Administrator access is required' } })
    return
  }
  next()
}

function readCookie(request: Request, name: string) {
  const cookies = request.header('cookie')?.split(';') ?? []
  const cookie = cookies.find((value) => value.trim().startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : undefined
}
