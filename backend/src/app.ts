import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { env } from './config/env.js'
import authRoutes from './routes/auth.routes.js'
import userRoutes from './routes/user.routes.js'
import fileRoutes from './routes/file.routes.js'
import folderRoutes from './routes/folder.routes.js'
import workspaceRoutes from './routes/workspace.routes.js'

export const app = express()

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: [env.FRONTEND_URL, 'http://127.0.0.1:5173'], credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }))
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/files', fileRoutes)
app.use('/api/folders', folderRoutes)

app.get('/api/health', (_request, response) => {
  response.json({ success: true, data: { service: 'ar-drive-api', status: 'ok' } })
})

app.use('/api', workspaceRoutes)

app.use((_request, response) => {
  response.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } })
})
