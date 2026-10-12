import { describe, it, expect } from "vitest";
import { assertTransition, nextStatuses, InvalidTransitionError } from "../src/modules/purchase-orders/state-machine";
import { lineTotal, sumTotals, stockStatus, availableStock } from "../src/modules/inventory/stock-math";

describe("purchase-order state machine", () => {
  it("allows the happy path with the right actors", () => {
    assertTransition("DRAFT", "SUBMITTED", "SHOP_OWNER");
    assertTransition("SUBMITTED", "ACCEPTED", "SUPPLIER");
    assertTransition("ACCEPTED", "PROCESSING", "SUPPLIER");
    assertTransition("PROCESSING", "SHIPPED", "SUPPLIER");
    assertTransition("SHIPPED", "DELIVERED", "SUPPLIER");
  });
  it("rejects skipped states", () => {
    expect(() => assertTransition("SUBMITTED", "SHIPPED", "SUPPLIER")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("DRAFT", "DELIVERED", "SHOP_OWNER")).toThrow(InvalidTransitionError);
  });
  it("rejects wrong actor", () => {
    expect(() => assertTransition("SUBMITTED", "ACCEPTED", "SHOP_OWNER")).toThrow(/only the SUPPLIER/);
    expect(() => assertTransition("DRAFT", "SUBMITTED", "SUPPLIER")).toThrow(InvalidTransitionError);
  });
  it("terminal states allow nothing", () => {
    for (const s of ["DELIVERED", "REJECTED", "CANCELLED"] as const)
      expect(nextStatuses(s, "SHOP_OWNER").concat(nextStatuses(s, "SUPPLIER"))).toEqual([]);
  });
  it("cannot cancel after processing starts", () => {
    expect(() => assertTransition("PROCESSING", "CANCELLED", "SHOP_OWNER")).toThrow();
  });
  it("requires a rejection reason", () => {
    expect(() => assertTransition("SUBMITTED", "REJECTED", "SUPPLIER")).toThrow(/reason/);
    expect(() => assertTransition("SUBMITTED", "REJECTED", "SUPPLIER", "  ")).toThrow(/reason/);
    assertTransition("SUBMITTED", "REJECTED", "SUPPLIER", "Out of stock");
  });
});

describe("stock & money math", () => {
  it("uses exact decimal arithmetic", () => {
    const t = sumTotals([lineTotal(3, "0.1"), lineTotal(3, "0.2")]);
    expect(t.toString()).toBe("0.9"); // floats would give 0.9000000000000001
  });
  it("rejects invalid quantities", () => {
    expect(() => lineTotal(0, "1")).toThrow();
    expect(() => lineTotal(1.5, "1")).toThrow();
    expect(() => lineTotal(-2, "1")).toThrow();
  });
  it("computes available stock and status", () => {
    expect(availableStock(10, 4)).toBe(6);
    expect(availableStock(3, 9)).toBe(0);
    expect(stockStatus(0, 0, 5, 10)).toBe("OUT_OF_STOCK");
    expect(stockStatus(5, 0, 5, 10)).toBe("LOW");
    expect(stockStatus(9, 0, 5, 10)).toBe("REORDER");
    expect(stockStatus(50, 0, 5, 10)).toBe("OK");
  });
});
