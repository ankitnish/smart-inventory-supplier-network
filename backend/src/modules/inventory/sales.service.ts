import { Prisma } from "@prisma/client";
import { prisma } from "../../services/prisma";
import { InsufficientStockError, lineTotal, sumTotals } from "./stock-math";
import { deductFromBatches } from "./expiry.service";

export interface SaleInput { idempotencyKey: string; items: { inventoryId: string; quantity: number; unitPrice: string }[]; }

/**
 * Records a sale atomically. Overselling is prevented by a conditional UPDATE
 * (quantity >= requested) inside the transaction, so concurrent sales cannot drive stock negative.
 * A retried request with the same idempotency key returns the original sale without touching stock.
 */
export async function recordSale(shopId: string, actorId: string, input: SaleInput) {
  const existing = await prisma.sale.findUnique({
    where: { shopId_idempotencyKey: { shopId, idempotencyKey: input.idempotencyKey } }, include: { items: true } });
  if (existing) return { sale: existing, replayed: true };

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const lines = input.items.map((i) => ({ ...i, total: lineTotal(i.quantity, i.unitPrice) }));
      const sale = await tx.sale.create({ data: {
        shopId, idempotencyKey: input.idempotencyKey, createdById: actorId, total: sumTotals(lines.map((l) => l.total)),
        items: { create: lines.map((l) => ({ inventoryId: l.inventoryId, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.total })) } },
        include: { items: true } });
      for (const l of lines) {
        const row = await tx.shopInventory.findFirst({ where: { id: l.inventoryId, shopId }, include: { product: true } });
        // Perishables sell first-expiry-first-out and never from expired batches.
        if (row?.product.perishable) await deductFromBatches(tx, l.inventoryId, l.quantity);
        // shopId in the WHERE clause blocks cross-shop access; quantity guard blocks overselling.
        const updated = await tx.shopInventory.updateMany({
          where: { id: l.inventoryId, shopId, isArchived: false, quantity: { gte: l.quantity } },
          data: { quantity: { decrement: l.quantity } } });
        if (updated.count !== 1) {
          const row = await tx.shopInventory.findFirst({ where: { id: l.inventoryId, shopId } });
          if (!row) throw new Error("Inventory item not found for this shop");
          throw new InsufficientStockError(row.quantity, l.quantity);
        }
        const after = await tx.shopInventory.findUniqueOrThrow({ where: { id: l.inventoryId } });
        await tx.stockMovement.create({ data: { inventoryId: l.inventoryId, type: "SALE", delta: -l.quantity,
          balanceAfter: after.quantity, reason: "Sale", refType: "Sale", refId: sale.id, actorId } });
      }
      return sale;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return { sale, replayed: false };
  } catch (e) {
    // Two simultaneous retries: the loser hits the unique key; return the winner's sale.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const won = await prisma.sale.findUnique({
        where: { shopId_idempotencyKey: { shopId, idempotencyKey: input.idempotencyKey } }, include: { items: true } });
      if (won) return { sale: won, replayed: true };
    }
    throw e;
  }
}
