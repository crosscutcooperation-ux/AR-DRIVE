# AR-DRIVE

AR-DRIVE is a local company file-drive application for secure uploads, sharing, search, and collaboration.

AR-Drive uses local filesystem storage only. AWS/S3 is not required.

## Requirements

- Node.js 20+
- npm
- SQLite via Prisma

## Project structure

- frontend/ — React + Vite + TypeScript interface
- backend/ — Express + TypeScript API server
- backend/data/ — SQLite database files
- backend/storage/ — uploaded files stored on the local machine
- docs/ — planning and notes

## Local setup

1. Copy `.env.example` to `.env` in the project root.
2. Update the values for your local machine.
3. Install dependencies:

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

## Database setup

```bash
cd backend
npx prisma generate
npx prisma migrate dev
```

## Run the app

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

## Local storage

Uploaded files are stored under the local storage root configured by `STORAGE_ROOT`, which defaults to `./storage` inside the backend working directory. Files are stored using generated safe keys and never from raw client filenames.

## Environment

The project expects a root `.env` file with values like:

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=file:./data/ar-drive.db
JWT_SECRET=change-me
JWT_REFRESH_SECRET=change-me-refresh
CLIENT_URL=http://localhost:5173
STORAGE_ROOT=./storage
```

## Troubleshooting

- If Prisma cannot find the database, run `npx prisma migrate dev`.
- If uploads fail, verify the `STORAGE_ROOT` directory exists and is writable.
- If the frontend cannot connect, ensure the backend is running and `CLIENT_URL` / API base URL match the environment.

## Build verification

```bash
npm --prefix frontend run build
npm --prefix backend run build
```
