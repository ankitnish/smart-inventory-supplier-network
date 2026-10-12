# Implementation report (current state)

## Built and verified
- ML service: forecast (moving avg, weighted MA, day-of-week seasonal; MAE/RMSE backtest; documented fallbacks),
  stockout, reorder (safety stock, incoming stock, MOQ/max), supplier ranking (normalized, configurable weights,
  exclusions, missing-data handling). **11 pytest tests pass.** No trained model is claimed (`/health` lists none).
- Backend pure logic: PO state machine (actor-restricted, rejection reason required), Decimal money math,
  stock status. **9 vitest tests pass.**

## Written but NOT executed (needs PostgreSQL + `prisma generate`; both unavailable in the build sandbox)
- Full Prisma schema (19 models), seed script, auth routes (register/login/lockout/reset/RBAC middleware),
  `recordSale` (anti-oversell + idempotency), `transitionOrder`, `receiveOrder` (exactly-once).
- `tsc` reports 9 errors, all from the missing generated Prisma client; to be confirmed after `prisma generate`.

## Not started
Next.js frontend and 3D landing page, product/inventory/supplier/PO/delivery/admin/analytics/recommendation API routes,
Socket.IO authorization and events, backend↔ML integration, Playwright/integration tests, API docs, CI.

## Known gaps
Password-reset email delivery is a stub (token logged in dev only). Migrations are generated on first `migrate dev`.
Integration tests for double-receive and concurrent oversell require a live database.
