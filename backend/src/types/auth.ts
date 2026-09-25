import type { Role } from '@prisma/client'

export type AuthTokenPayload = {
  sub: string
  role: Role
  type: 'access' | 'refresh'
}

export type AuthenticatedUser = {
  id: string
  role: Role
}
