# AR-DRIVE Architecture

The project is split into an independently maintainable React frontend and Express backend. SQLite and Prisma store relational metadata, while uploaded files are streamed to the private `backend/uploads` directory. The API owns authentication, authorization, metadata, and file access decisions.
