import { HttpError } from "../../utils/http";

export type RecStatus = "PENDING" | "ADJUSTED" | "CONFIRMED" | "DISMISSED" | "ORDERED";
export type RecAction = "adjust" | "confirm" | "dismiss" | "order";
export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** A recommendation becomes an order only after the owner explicitly confirms it. */
const TRANSITIONS: Record<RecStatus, Partial<Record<RecAction, RecStatus>>> = {
  PENDING: { adjust: "ADJUSTED", confirm: "CONFIRMED", dismiss: "DISMISSED" },
  ADJUSTED: { adjust: "ADJUSTED", confirm: "CONFIRMED", dismiss: "DISMISSED" },
  CONFIRMED: { adjust: "ADJUSTED", dismiss: "DISMISSED", order: "ORDERED" }, // adjusting after confirming requires confirming again
  ORDERED: {},
  DISMISSED: {},
};
export function nextRecStatus(from: RecStatus, action: RecAction): RecStatus {
  const to = TRANSITIONS[from][action];
  if (!to) throw new HttpError(409, `Cannot ${action} a recommendation that is ${from.toLowerCase()}`, "INVALID_TRANSITION");
  return to;
}

export function riskFromMl(level: string): Risk {
  const u = level.toUpperCase();
  if (u === "LOW" || u === "MEDIUM" || u === "HIGH" || u === "CRITICAL") return u;
  throw new Error(`Unknown risk level from ML service: ${level}`);
}

/**
 * Sales rows -> one point per completed UTC day. Today is excluded (a partial day understates demand).
 * If the last sale is older than yesterday, a zero is added for yesterday so the forecast sees the gap.
 * No rows at all returns [] so the ML service reports "no data" rather than a made-up history.
 */
export function toDailyPairs(rows: { quantity: number; soldAt: Date }[], now: Date) {
  const todayKey = now.toISOString().slice(0, 10);
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = r.soldAt.toISOString().slice(0, 10);
    if (k >= todayKey) continue;
    m.set(k, (m.get(k) ?? 0) + r.quantity);
  }
  if (m.size === 0) return [];
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if ([...m.keys()].every((k) => k < yesterday)) m.set(yesterday, 0);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, quantity]) => ({ date, quantity }));
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
export function buildReorderPayload(a: { productId: string; availableStock: number; dailyDemand: number; dailyDemandStd: number; leadTimeDays: number;
  reviewPeriodDays: number; serviceLevelZ: number; incomingQuantity: number; minOrderQty?: number; maxOrderQty?: number }) {
  return { product_id: a.productId, available_stock: r4(Math.max(0, a.availableStock)), daily_demand: r4(Math.max(0, a.dailyDemand)),
    daily_demand_std: r4(Math.max(0, a.dailyDemandStd)), lead_time_days: a.leadTimeDays, review_period_days: a.reviewPeriodDays,
    service_level_z: a.serviceLevelZ, incoming_quantity: a.incomingQuantity, min_order_quantity: a.minOrderQty ?? 0,
    ...(a.maxOrderQty != null ? { max_order_quantity: a.maxOrderQty } : {}) };
}
