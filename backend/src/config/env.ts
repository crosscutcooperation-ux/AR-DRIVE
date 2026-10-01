import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default('file:./data/ar-drive.db'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32).default('change-me-change-me-change-me-1234'),
  JWT_REFRESH_SECRET: z.string().min(32).default('change-me-refresh-change-me-refresh-5678'),
  STORAGE_ROOT: z.string().min(1).default('./storage'),
})

export const env = envSchema.parse(process.env)
