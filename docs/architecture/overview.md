# Architecture
Browser (Next.js) → Express API (auth, RBAC, transactions) → PostgreSQL (Prisma).
API → FastAPI ML service over HTTP (`/ml/forecast|stockout|reorder|supplier-rank`), advisory only.
API → Socket.IO (+ optional Redis adapter) → authorized rooms.
Flow: Sale → inventory decrement + movement → forecast → stockout risk → reorder recommendation → supplier ranking → PO → delivery → exactly-once receipt.
