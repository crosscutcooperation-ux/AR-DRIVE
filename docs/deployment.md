# AR-DRIVE Deployment

Deploy the static frontend and Node.js API separately if desired, but keep the SQLite database and `backend/uploads` directory on persistent storage available to the API.

The backend stores uploaded files under `backend/uploads` using generated opaque filenames and records the storage key and metadata in SQLite. Uploads and downloads pass through authenticated API routes. Back up the database and uploads directory together. A single API instance should own this local storage unless all instances share the same persistent filesystem.
