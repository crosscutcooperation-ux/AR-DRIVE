import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireActiveUser, requireAdmin, requireAuth } from '../middleware/auth.middleware.js'
import { hashPassword, toPublicUser } from '../services/auth.service.js'

const router = Router()
const roleSchema = z.enum(['ADMIN', 'USER'])
const quotaSchema = z.union([z.string(), z.number()]).transform((value, context) => {
  try {
    const quota = BigInt(value)
    if (quota <= 0n) throw new Error('Quota must be positive')
    return quota
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Storage quota must be a positive integer' })
    return z.NEVER
  }
})
const createUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  role: roleSchema.default('USER'),
  storageQuota: quotaSchema.optional(),
})
const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  password: z.string().min(8).max(128).optional(),
  role: roleSchema.optional(),
  storageQuota: quotaSchema.optional(),
  isActive: z.boolean().optional(),
}).strict()

router.use(requireAuth, requireActiveUser, requireAdmin)

router.get('/', async (request, response) => {
  const page = parsePositiveInt(request.query.page, 1)
  const limit = Math.min(parsePositiveInt(request.query.limit, 25), 100)
  const search = typeof request.query.search === 'string' ? request.query.search.trim() : ''
  const where = search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : undefined
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.user.count({ where }),
  ])
  response.json({ success: true, data: { users: users.map(toPublicUser), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } })
})

router.get('/:id', async (request, response) => {
  const user = await prisma.user.findUnique({ where: { id: request.params.id } })
  if (!user) {
    response.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
    return
  }
  response.json({ success: true, data: { user: toPublicUser(user) } })
})

router.post('/', async (request, response) => {
  const parsed = createUserSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'User details are invalid' } })
    return
  }
  const { name, email, password, role, storageQuota } = parsed.data
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    response.status(409).json({ success: false, error: { code: 'EMAIL_IN_USE', message: 'An account with this email already exists' } })
    return
  }
  const user = await prisma.user.create({ data: { name, email, passwordHash: await hashPassword(password), role, ...(storageQuota === undefined ? {} : { storageQuota }) } })
  response.status(201).json({ success: true, data: { user: toPublicUser(user) } })
})

router.patch('/:id', async (request, response) => {
  const parsed = updateUserSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'User update is invalid' } })
    return
  }
  if (request.params.id === request.user!.id && parsed.data.isActive === false) {
    response.status(409).json({ success: false, error: { code: 'SELF_DEACTIVATION', message: 'You cannot deactivate your own account' } })
    return
  }
  const currentUser = await prisma.user.findUnique({ where: { id: request.params.id } })
  if (!currentUser) {
    response.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
    return
  }
  const { password, ...fields } = parsed.data
  const user = await prisma.user.update({ where: { id: currentUser.id }, data: { ...fields, ...(password ? { passwordHash: await hashPassword(password) } : {}) } })
  response.json({ success: true, data: { user: toPublicUser(user) } })
})

router.delete('/:id', async (request, response) => {
  if (request.params.id === request.user!.id) {
    response.status(409).json({ success: false, error: { code: 'SELF_DEACTIVATION', message: 'You cannot deactivate your own account' } })
    return
  }
  const user = await prisma.user.findUnique({ where: { id: request.params.id } })
  if (!user) {
    response.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
    return
  }
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
  response.status(204).send()
})

function parsePositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export default router
