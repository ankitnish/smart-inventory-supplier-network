import { describe, it, expect } from "vitest";
import { allocateFEFO, daysUntilExpiry, effectiveAvailable, expiredQuantity, expiryStatus, projectedWaste, sellableQuantity } from "../src/modules/inventory/expiry";
import { InsufficientStockError } from "../src/modules/inventory/stock-math";

const today = new Date("2026-10-11T15:30:00Z"); // time of day must not matter
const d = (n: number) => new Date(Date.UTC(2026, 9, 11 + n));
const B = (id: string, quantity: number, off: number) => ({ id, quantity, expiryDate: d(off) });

describe("expiry status", () => {
  it("treats the expiry date itself as still sellable", () => {
    expect(daysUntilExpiry(d(0), today)).toBe(0);
    expect(expiryStatus(d(0), today, 7)).toBe("EXPIRING_SOON");
    expect(expiryStatus(d(-1), today, 7)).toBe("EXPIRED");
    expect(expiryStatus(d(7), today, 7)).toBe("EXPIRING_SOON");
    expect(expiryStatus(d(8), today, 7)).toBe("OK");
  });
});

describe("FEFO allocation", () => {
  it("sells earliest expiry first and splits across batches", () => {
    expect(allocateFEFO([B("late", 50, 20), B("early", 5, 2)], 8, today)).toEqual([{ batchId: "early", take: 5 }, { batchId: "late", take: 3 }]);
  });
  it("never sells expired batches", () => {
    const batches = [B("old", 100, -1), B("ok", 4, 5)];
    expect(sellableQuantity(batches, today)).toBe(4);
    expect(expiredQuantity(batches, today)).toBe(100);
    expect(() => allocateFEFO(batches, 5, today)).toThrow(InsufficientStockError);
  });
  it("rejects invalid quantities and ignores empty batches", () => {
    expect(() => allocateFEFO([B("a", 5, 3)], 0, today)).toThrow();
    expect(allocateFEFO([B("empty", 0, 1), B("a", 5, 3)], 2, today)).toEqual([{ batchId: "a", take: 2 }]);
  });
});

describe("projected waste", () => {
  it("counts units that expire before FEFO selling reaches them", () => {
    // 5/day: batch A (30u, 3 selling days incl. today+2) sells 15, wastes 15; batch B is fully covered.
    expect(projectedWaste([B("a", 30, 2), B("b", 100, 60)], 5, today)).toBe(15);
  });
  it("is zero when demand outpaces expiry", () => {
    expect(projectedWaste([B("a", 10, 5)], 10, today)).toBe(0);
  });
  it("treats everything as waste when there is no demand", () => {
    expect(projectedWaste([B("a", 10, 5)], 0, today)).toBe(10);
  });
  it("effective availability excludes expired and doomed units", () => {
    expect(effectiveAvailable([B("old", 9, -3), B("a", 30, 2), B("b", 100, 60)], 5, today)).toBe(115);
  });
});
