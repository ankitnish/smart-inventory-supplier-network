# Smart Inventory + Supplier Network
**Track → Predict → Recommend → Order.** Inventory, supplier discovery, procurement and advisory demand planning.

> Status: **Phase 1 foundation + ML service + core business rules.** See `docs/project-report/implementation-report.md` for exactly what is built, tested and still open.

## Layout
`backend/` Express + Prisma API · `ml-service/` FastAPI forecasting/decision support · `frontend/` Next.js (not yet built) · `realtime/` Socket.IO event contracts · `docs/` architecture and reports

## Run locally
```bash
cp .env.example .env            # replace every placeholder
docker compose up -d postgres redis ml-service
cd backend && npm install && npx prisma generate
npx prisma migrate dev --name init   # creates migrations from schema.prisma
npm run seed                     # fictional demo data (flagged isDemo)
npm run dev                      # http://localhost:4000/api/health
```
ML service standalone: `cd ml-service && pip install -r requirements.txt && uvicorn app.main:app --port 8000` (OpenAPI at `/docs`).

## Tests
`cd ml-service && pytest` · `cd backend && npm test`

## Key design rules
- Role and status are read from the database on every request; the browser never asserts a role.
- `ADMIN` is excluded from public registration; create it via seed/CLI with `ADMIN_*` env vars.
- Sales: conditional `UPDATE ... WHERE quantity >= n` in one transaction (no overselling) + idempotency key (safe retries).
- Order receipt: `receivedAt` claimed by a conditional update, plus a unique `(type, refId, inventoryId)` movement, so stock is replenished exactly once.
- Money uses `Decimal`; ML recommendations are advisory and never place orders or change stock.
