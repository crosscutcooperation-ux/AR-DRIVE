# AR-DRIVE API

The API uses JSON responses with a consistent envelope:

```json
{ "success": true, "data": {} }
```

Errors use the matching `success: false` envelope. Current endpoints include:

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/users` (administrator)
- `GET /api/users/:id` (administrator)
- `POST /api/users` (administrator)
- `PATCH /api/users/:id` (administrator)
- `DELETE /api/users/:id` (administrator; deactivates the account)
- `GET /api/folders`
- `GET /api/folders/:id`
- `POST /api/folders`
- `PATCH /api/folders/:id`
- `DELETE /api/folders/:id`
- `GET /api/files`
- `GET /api/files/:id/download`
- `POST /api/files/upload/initiate`
- `POST /api/files/upload/finalize`
- `PATCH /api/files/:id`
- `DELETE /api/files/:id` (soft delete)
- `GET /api/search?q=...`
- `GET /api/recent`
- `GET /api/starred`
- `POST /api/starred/:id`
- `DELETE /api/starred/:id`
- `GET /api/trash`
- `POST /api/trash/:id/restore`
- `DELETE /api/trash/:id` (permanent delete)
- `GET /api/shares`
- `POST /api/shares`
- `PATCH /api/shares/:id`
- `DELETE /api/shares/:id`
