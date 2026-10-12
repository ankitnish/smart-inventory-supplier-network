/** Pure expiry logic (no DB). Dates are compared as UTC calendar days. */
import { InsufficientStockError } from "./stock-math";

export type ExpiryStatus = "EXPIRED" | "EXPIRING_SOON" | "OK";
export interface Batch { id: string; quantity: number; expiryDate: Date }

const MS_DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Days from `today` to the expiry date (0 = expires today, negative = already expired). */
export const daysUntilExpiry = (expiry: Date, today: Date) => Math.round((utcDay(expiry) - utcDay(today)) / MS_DAY);

export function expiryStatus(expiry: Date, today: Date, warnDays: number): ExpiryStatus {
  const d = daysUntilExpiry(expiry, today);
  return d < 0 ? "EXPIRED" : d <= warnDays ? "EXPIRING_SOON" : "OK";
}

const sellable = (b: Batch, today: Date) => b.quantity > 0 && daysUntilExpiry(b.expiryDate, today) >= 0;
const byExpiry = (a: Batch, b: Batch) => a.expiryDate.getTime() - b.expiryDate.getTime() || a.id.localeCompare(b.id);

export const sellableQuantity = (batches: Batch[], today: Date) =>
  batches.filter((b) => sellable(b, today)).reduce((n, b) => n + b.quantity, 0);

export const expiredQuantity = (batches: Batch[], today: Date) =>
  batches.filter((b) => b.quantity > 0 && daysUntilExpiry(b.expiryDate, today) < 0).reduce((n, b) => n + b.quantity, 0);

/** First-expiry-first-out allocation. Expired batches are never sold. Throws if sellable stock is short. */
export function allocateFEFO(batches: Batch[], qty: number, today: Date) {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("Quantity must be a positive integer");
  const pool = batches.filter((b) => sellable(b, today)).sort(byExpiry);
  const total = pool.reduce((n, b) => n + b.quantity, 0);
  if (total < qty) throw new InsufficientStockError(total, qty); // expired stock is excluded from "available"
  let left = qty;
  const out: { batchId: string; take: number }[] = [];
  for (const b of pool) {
    if (left === 0) break;
    const take = Math.min(b.quantity, left);
    out.push({ batchId: b.id, take });
    left -= take;
  }
  return out;
}

/**
 * Units expected to expire unsold, assuming constant daily demand and FEFO selling.
 * A batch can be sold on each day through its expiry date inclusive.
 */
export function projectedWaste(batches: Batch[], dailyDemand: number, today: Date) {
  let consumed = 0, waste = 0;
  for (const b of batches.filter((x) => sellable(x, today)).sort(byExpiry)) {
    const demandUntilExpiry = dailyDemand * (daysUntilExpiry(b.expiryDate, today) + 1);
    const sold = Math.min(b.quantity, Math.max(0, demandUntilExpiry - consumed));
    consumed += sold;
    waste += b.quantity - sold;
  }
  return Math.round(waste * 100) / 100;
}

/** Stock the reorder planner should treat as usable: sellable minus what is projected to expire first. */
export const effectiveAvailable = (batches: Batch[], dailyDemand: number, today: Date) =>
  Math.max(0, sellableQuantity(batches, today) - projectedWaste(batches, dailyDemand, today));
