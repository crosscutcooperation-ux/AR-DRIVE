# AR-DRIVE Security

Uploaded files are stored under the backend's private `uploads` directory and are never exposed as static files. All upload, download, and delete operations pass through authenticated API routes. Keep the directory out of source control, restrict operating-system access to the API service account, and protect it with encrypted backups. The backend is the source of truth for authentication and authorization.

The uploads directory is local to the API host. Use persistent storage and back it up with the SQLite database; do not run multiple API instances with separate local upload directories if users need to see the same files.
