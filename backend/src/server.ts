import { app } from './app.js'
import { env } from './config/env.js'
import { cleanupExpiredUploadSessions } from './services/upload-cleanup.service.js'

const server = app.listen(env.PORT, () => {
  console.log(`AR-DRIVE API listening on http://localhost:${env.PORT}`)
})
server.requestTimeout = 60 * 60 * 1000

void cleanupExpiredUploadSessions()
const uploadCleanupTimer = setInterval(() => void cleanupExpiredUploadSessions(), 15 * 60 * 1000)
uploadCleanupTimer.unref()
