import { app } from './app.js'
import { env } from './config/env.js'
import { cleanupExpiredUploadSessions } from './services/upload-cleanup.service.js'

app.listen(env.PORT, () => {
  console.log(`AR-DRIVE API listening on http://localhost:${env.PORT}`)
})

void cleanupExpiredUploadSessions()
const uploadCleanupTimer = setInterval(() => void cleanupExpiredUploadSessions(), 15 * 60 * 1000)
uploadCleanupTimer.unref()
