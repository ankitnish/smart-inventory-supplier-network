import { Prisma } from "@prisma/client";
import { prisma } from "../../services/prisma";
import { allocateFEFO, daysUntilExpiry, expiryStatus } from "./expiry";

type Tx = Prisma.TransactionClient;

/** Called inside a sale transaction. Conditional per-batch updates guard against concurrent sales. */
export async function deductFromBatches(tx: Tx, inventoryId: string, qty: number, today = new Date()) {
  const batches = await tx.inventoryBatch.findMany({ where: { inventoryId, quantity: { gt: 0 } } });
  for (const a of allocateFEFO(batches, qty, today)) {
    const r = await tx.inventoryBatch.updateMany({ where: { id: a.batchId, quantity: { gte: a.take } }, data: { quantity: { decrement: a.take } } });
    if (r.count !== 1) throw new Error("Batch stock changed concurrently; retry the sale");
  }
}

/**
 * Explicit, audited write-off of expired stock. Never automatic: the owner confirms with a reason.
 * Idempotent: only batches that still hold units and are expired are touched, and the movement row
 * is unique on (type, refId=batchId, inventoryId).
 */
export async function writeOffExpired(shopId: string, actorId: string, batchIds: string[], reason: string, today = new Date()) {
  if (!reason.trim()) throw new Error("A write-off reason is required");
  return prisma.$transaction(async (tx) => {
    const batches = await tx.inventoryBatch.findMany({
      where: { id: { in: batchIds }, quantity: { gt: 0 }, inventory: { shopId } } }); // shopId scope blocks cross-shop writes
    let written = 0;
    for (const b of batches) {
      if (daysUntilExpiry(b.expiryDate, today) >= 0) continue; // not expired: refuse
      const claimed = await tx.inventoryBatch.updateMany({ where: { id: b.id, quantity: b.quantity }, data: { quantity: 0 } });
      if (claimed.count !== 1) continue;
      const inv = await tx.shopInventory.update({ where: { id: b.inventoryId }, data: { quantity: { decrement: b.quantity } } });
      await tx.stockMovement.create({ data: { inventoryId: b.inventoryId, type: "EXPIRY_WRITE_OFF", delta: -b.quantity,
        balanceAfter: inv.quantity, reason, refType: "InventoryBatch", refId: b.id, actorId } });
      written += b.quantity;
    }
    await tx.auditLog.create({ data: { actorId, action: "inventory.expiry-write-off", entity: "Shop", entityId: shopId, metadata: { batchIds, units: written } } });
    return { unitsWrittenOff: written };
  });
}

/** Scheduled scan (e.g. daily cron). Creates one notification per batch per status, never changes stock. */
export async function scanExpiryAlerts(shopId: string, today = new Date()) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const batches = await prisma.inventoryBatch.findMany({
    where: { quantity: { gt: 0 }, inventory: { shopId, product: { perishable: true } } },
    include: { inventory: { include: { product: true } } } });
  let created = 0;
  for (const b of batches) {
    const st = expiryStatus(b.expiryDate, today, b.inventory.expiryWarnDays);
    if (st === "OK") continue;
    const type = st === "EXPIRED" ? "inventory.expired" : "inventory.expiring-soon";
    const dup = await prisma.notification.findFirst({ where: { userId: shop.ownerId, type, data: { path: ["batchId"], equals: b.id } } });
    if (dup) continue;
    const d = daysUntilExpiry(b.expiryDate, today);
    await prisma.notification.create({ data: { userId: shop.ownerId, type,
      title: st === "EXPIRED" ? `Expired: ${b.inventory.product.name}` : `Expiring soon: ${b.inventory.product.name}`,
      body: `${b.quantity} units (lot ${b.lotCode ?? "n/a"}) ${st === "EXPIRED" ? `expired ${-d} day(s) ago` : `expire in ${d} day(s)`}.`,
      data: { batchId: b.id, inventoryId: b.inventoryId } } });
    created++;
  }
  return { notificationsCreated: created };
}
