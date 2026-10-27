import { describe, it, expect } from "vitest";
import { buildReorderPayload, nextRecStatus, riskFromMl, toDailyPairs } from "../src/modules/recommendations/recommendation-rules";

describe("recommendation status rules", () => {
  it("only lets a confirmed recommendation become an order", () => {
    expect(nextRecStatus("PENDING", "confirm")).toBe("CONFIRMED");
    expect(nextRecStatus("CONFIRMED", "order")).toBe("ORDERED");
    expect(() => nextRecStatus("PENDING", "order")).toThrow(/Cannot order/);
    expect(() => nextRecStatus("ADJUSTED", "order")).toThrow();
  });
  it("makes the owner re-confirm after adjusting", () => {
    expect(nextRecStatus("CONFIRMED", "adjust")).toBe("ADJUSTED");
    expect(() => nextRecStatus("ADJUSTED", "order")).toThrow();
  });
  it("treats ordered and dismissed as final", () => {
    for (const a of ["adjust", "confirm", "dismiss", "order"] as const) {
      expect(() => nextRecStatus("ORDERED", a)).toThrow();
      expect(() => nextRecStatus("DISMISSED", a)).toThrow();
    }
  });
});

describe("risk mapping", () => {
  it("maps ML levels and rejects unknown ones", () => {
    expect(riskFromMl("high")).toBe("HIGH");
    expect(riskFromMl("CRITICAL")).toBe("CRITICAL");
    expect(() => riskFromMl("severe")).toThrow();
  });
});

describe("sales history preparation", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  const row = (iso: string, quantity: number) => ({ quantity, soldAt: new Date(iso) });
  it("sums sales per day and sorts them", () => {
    expect(toDailyPairs([row("2026-10-13T09:00:00Z", 2), row("2026-10-12T09:00:00Z", 1), row("2026-10-13T18:00:00Z", 3), row("2026-10-14T01:00:00Z", 4)], now))
      .toEqual([{ date: "2026-10-12", quantity: 1 }, { date: "2026-10-13", quantity: 5 }, { date: "2026-10-14", quantity: 4 }]);
  });
  it("ignores today because it is only a partial day", () => {
    expect(toDailyPairs([row("2026-10-15T08:00:00Z", 9), row("2026-10-14T08:00:00Z", 2)], now)).toEqual([{ date: "2026-10-14", quantity: 2 }]);
  });
  it("adds a zero for yesterday when sales stopped, so the forecast sees the gap", () => {
    expect(toDailyPairs([row("2026-10-10T08:00:00Z", 6)], now)).toEqual([{ date: "2026-10-10", quantity: 6 }, { date: "2026-10-14", quantity: 0 }]);
  });
  it("returns nothing when there is no history, instead of inventing one", () => {
    expect(toDailyPairs([], now)).toEqual([]);
    expect(toDailyPairs([row("2026-10-15T08:00:00Z", 3)], now)).toEqual([]);
  });
});

describe("reorder payload", () => {
  it("never sends negative values and only caps when a maximum exists", () => {
    const p = buildReorderPayload({ productId: "p", availableStock: -3, dailyDemand: 4.123456789, dailyDemandStd: 0, leadTimeDays: 2, reviewPeriodDays: 7, serviceLevelZ: 1.65, incomingQuantity: 0 });
    expect(p.available_stock).toBe(0); expect(p.daily_demand).toBe(4.1235); expect(p).not.toHaveProperty("max_order_quantity");
    expect(buildReorderPayload({ productId: "p", availableStock: 1, dailyDemand: 1, dailyDemandStd: 0, leadTimeDays: 1, reviewPeriodDays: 1, serviceLevelZ: 1, incomingQuantity: 0, maxOrderQty: 50, minOrderQty: 5 }))
      .toMatchObject({ max_order_quantity: 50, min_order_quantity: 5 });
  });
});
