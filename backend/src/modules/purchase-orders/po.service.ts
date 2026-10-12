import { prisma } from "../../services/prisma";
import { Actor, assertTransition } from "./state-machine";
import { POStatus } from "@prisma/client";
import { daysUntilExpiry } from "../inventory/expiry";

/** Generic guarded transition. Compare-and-set on `status` prevents concurrent double transitions. */
export async function transitionOrder(orderId: string, actorId: string, actor: Actor, to: POStatus,
                                      scope: { shopId?: string; supplierId?: string }, note?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findFirst({ where: { id: orderId, ...scope } });
    if (!order) throw new Error("Order not found"); // same message whether missing or not yours: no info leak
    assertTransition(order.status, to, actor, to === "REJECTED" ? note : undefined);
    const res = await tx.purchaseOrder.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: to, rejectionReason: to === "REJECTED" ? note : undefined } });
    if (res.count !== 1) throw new Error("Order was modified concurrently; retry");
    await tx.pOStatusHistory.create({ data: { orderId, from: order.status, to, actorId, note } });
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
  });
}

/**
 * Receive goods exactly once. `receivedAt` is claimed with a conditional update; a second call
 * matches zero rows and is a no-op. Per-line StockMovement also has a unique (type, refId, inventoryId).
 */
export async function receiveOrder(orderId: string, shopId: string, actorId: string, expiryOverrides: Record<string, string> = {}) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.purchaseOrder.updateMany({
      where: { id: orderId, shopId, status: { in: ["SHIPPED", "DELIVERED"] }, receivedAt: null },
      data: { receivedAt: new Date(), status: "DELIVERED" } });
    if (claim.count === 0) {
      const o = await tx.purchaseOrder.findFirst({ where: { id: orderId, shopId } });
      if (!o) throw new Error("Order not found");
      if (o.receivedAt) return { alreadyReceived: true as const, order: o };
      throw new Error(`Order cannot be received while ${o.status}`);
    }
    const items = await tx.purchaseOrderItem.findMany({ where: { orderId } });
    for (const it of items) {
      const inv = await tx.shopInventory.findUnique({ where: { shopId_productId: { shopId, productId: it.productId } }, include: { product: true } });
      if (!inv) throw new Error("Product is not in this shop's inventory");
      const after = await tx.shopInventory.update({ where: { id: inv.id }, data: { quantity: { increment: it.quantity } } });
      if (inv.product.perishable) {
        // Throwing here rolls back the whole transaction, including the receivedAt claim.
        const raw = expiryOverrides[it.id] ?? it.expiryDate?.toISOString().slice(0, 10);
        const expiry = raw ? new Date(raw) : null;
        if (!expiry || Number.isNaN(expiry.getTime())) throw new Error(`Expiry date required for perishable product "${inv.product.name}"`);
        if (daysUntilExpiry(expiry, new Date()) < 0) throw new Error(`"${inv.product.name}" is already expired; reject this delivery instead of receiving it`);
        await tx.inventoryBatch.create({ data: { inventoryId: inv.id, quantity: it.quantity, receivedQty: it.quantity, expiryDate: expiry, lotCode: it.lotCode, sourceOrderId: orderId } });
      }
      await tx.stockMovement.create({ data: { inventoryId: inv.id, type: "PURCHASE_RECEIPT", delta: it.quantity,
        balanceAfter: after.quantity, reason: "Purchase order received", refType: "PurchaseOrder", refId: orderId, actorId } });
    }
    await tx.pOStatusHistory.create({ data: { orderId, from: "SHIPPED", to: "DELIVERED", actorId, note: "Goods received" } });
    return { alreadyReceived: false as const, order: await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } }) };
  });
}
