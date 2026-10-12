import { Decimal } from "@prisma/client/runtime/library";

export type StockStatus = "OUT_OF_STOCK" | "LOW" | "REORDER" | "OK";

export const availableStock = (quantity: number, reserved: number) => Math.max(0, quantity - reserved);

export function stockStatus(quantity: number, reserved: number, minLevel: number, reorderPoint: number): StockStatus {
  const a = availableStock(quantity, reserved);
  if (a <= 0) return "OUT_OF_STOCK";
  if (a <= minLevel) return "LOW";
  if (a <= reorderPoint) return "REORDER";
  return "OK";
}

/** Money is always Decimal; never floats. */
export function lineTotal(qty: number, unitPrice: Decimal | string | number) {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("Quantity must be a positive integer");
  return new Decimal(unitPrice).mul(qty);
}
export const sumTotals = (lines: Decimal[]) => lines.reduce((a, b) => a.add(b), new Decimal(0));

export class InsufficientStockError extends Error {
  constructor(public available: number, public requested: number) {
    super(`Insufficient stock: ${available} available, ${requested} requested`);
  }
}
