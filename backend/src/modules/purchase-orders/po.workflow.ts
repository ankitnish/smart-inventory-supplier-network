import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/http";
import { lineTotal, sumTotals } from "../inventory/stock-math";
import { daysUntilExpiry } from "../inventory/expiry";
import { OrderHook, receiveOrder, transitionOrder } from "./po.service";

const orderNumber = () => `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

async function notifyParty(orderId: string, party: "shop" | "supplier", title: string, body: string) {
  const o = await prisma.purchaseOrder.findUnique({ where: { id: orderId }, include: { shop: true, supplier: true } });
  if (!o) return;
  await prisma.notification.create({ data: { userId: party === "shop" ? o.shop.ownerId : o.supplier.ownerId,
    type: "purchase-order.updated", title, body: `${o.number}: ${body}`, data: { orderId } } });
}
const audit = (actorId: string, action: string, orderId: string, metadata?: Prisma.InputJsonValue) =>
  prisma.auditLog.create({ data: { actorId, action, entity: "PurchaseOrder", entityId: orderId, metadata } });

// ---------------------------------------------------------------- shop side
export interface CreateOrderInput { supplierId: string; idempotencyKey: string; items: { supplierProductId: string; quantity: number }[] }

export async function createOrder(shopId: string, actorId: string, input: CreateOrderInput) {
  const find = () => prisma.purchaseOrder.findUnique({ where: { shopId_idempotencyKey: { shopId, idempotencyKey: input.idempotencyKey } }, include: { items: true } });
  const existing = await find();
  if (existing) return { order: existing, replayed: true };
  const ids = input.items.map((i) => i.supplierProductId);
  if (new Set(ids).size !== ids.length) throw new HttpError(422, "Each offer may appear once per order", "DUPLICATE_LINE");
  try {
    const order = await prisma.$transaction(async (tx) => {
      // Prices and availability always come from the supplier's own records, never from the client.
      const offers = await tx.supplierProduct.findMany({ where: { id: { in: ids }, supplierId: input.supplierId, isActive: true, supplier: { owner: { status: "ACTIVE" } } } });
      if (offers.length !== ids.length) throw new HttpError(422, "One or more offers are unavailable or belong to a different supplier", "BAD_OFFER");
      const inv = await tx.shopInventory.findMany({ where: { shopId, productId: { in: offers.map((o) => o.productId) }, isArchived: false } });
      if (inv.length !== offers.length) throw new HttpError(422, "Add the product to your inventory before ordering it", "NOT_IN_INVENTORY");
      const lines = input.items.map((i) => {
        const o = offers.find((x) => x.id === i.supplierProductId)!;
        if (i.quantity < o.minOrderQty) throw new HttpError(422, `Minimum order for this item is ${o.minOrderQty}`, "BELOW_MOQ");
        if (i.quantity > o.quantity) throw new HttpError(422, `Supplier has only ${o.quantity} available`, "EXCEEDS_STOCK");
        return { supplierProductId: o.id, productId: o.productId, quantity: i.quantity, unitPrice: o.unitPrice, lineTotal: lineTotal(i.quantity, o.unitPrice) };
      });
      const created = await tx.purchaseOrder.create({ include: { items: true }, data: {
        number: orderNumber(), shopId, supplierId: input.supplierId, status: "DRAFT", idempotencyKey: input.idempotencyKey,
        total: sumTotals(lines.map((l) => l.lineTotal)), items: { create: lines } } });
      await tx.pOStatusHistory.create({ data: { orderId: created.id, to: "DRAFT", actorId, note: "Created" } });
      return created;
    });
    await audit(actorId, "purchase-order.create", order.id);
    return { order, replayed: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { const won = await find(); if (won) return { order: won, replayed: true }; }
    throw e;
  }
}

export async function submitOrder(shopId: string, actorId: string, orderId: string) {
  const o = await transitionOrder(orderId, actorId, "SHOP_OWNER", "SUBMITTED", { shopId });
  await audit(actorId, "purchase-order.submit", orderId);
  await notifyParty(orderId, "supplier", "New purchase order", "A shop submitted a new order awaiting your response.");
  return o;
}

/** Stock reserved at acceptance is released if the shop cancels before processing starts. */
export async function cancelOrder(shopId: string, actorId: string, orderId: string) {
  const o = await transitionOrder(orderId, actorId, "SHOP_OWNER", "CANCELLED", { shopId }, "Cancelled by shop", async (tx, order) => {
    if (order.status === "ACCEPTED") await adjustReserved(tx, order, actorId, +1, "Released: order cancelled");
  });
  await audit(actorId, "purchase-order.cancel", orderId);
  await notifyParty(orderId, "supplier", "Order cancelled", "The shop cancelled this order.");
  return o;
}

export async function receiveGoods(shopId: string, actorId: string, orderId: string, expiryOverrides: Record<string, string> = {}) {
  const out = await receiveOrder(orderId, shopId, actorId, expiryOverrides);
  if (!out.alreadyReceived) {
    await audit(actorId, "purchase-order.receive", orderId);
    await notifyParty(orderId, "supplier", "Goods received", "The shop confirmed receipt of this order.");
  }
  return out;
}

// -------------------------------------------------------------- supplier side
async function adjustReserved(tx: Prisma.TransactionClient, order: { number: string; items: { supplierProductId: string; quantity: number }[] }, actorId: string, sign: 1 | -1, reason: string) {
  for (const it of order.items) {
    // Reserving uses a conditional update so two orders can never claim the same units.
    const r = await tx.supplierProduct.updateMany({ where: { id: it.supplierProductId, ...(sign < 0 ? { quantity: { gte: it.quantity } } : {}) }, data: { quantity: { increment: sign * it.quantity } } });
    if (r.count !== 1) throw new HttpError(409, "Insufficient supplier stock to accept this order", "INSUFFICIENT_SUPPLIER_STOCK");
    const after = await tx.supplierProduct.findUniqueOrThrow({ where: { id: it.supplierProductId } });
    await tx.supplierStockMovement.create({ data: { supplierProductId: it.supplierProductId, delta: sign * it.quantity, balanceAfter: after.quantity, reason: `${reason} (${order.number})`, actorId } });
  }
}

export async function acceptOrder(supplierId: string, actorId: string, orderId: string) {
  const o = await transitionOrder(orderId, actorId, "SUPPLIER", "ACCEPTED", { supplierId }, undefined, (tx, order) => adjustReserved(tx, order, actorId, -1, "Reserved: order accepted"));
  await audit(actorId, "purchase-order.accept", orderId);
  await notifyParty(orderId, "shop", "Order accepted", "The supplier accepted your order.");
  return o;
}
export async function rejectOrder(supplierId: string, actorId: string, orderId: string, reason: string) {
  const o = await transitionOrder(orderId, actorId, "SUPPLIER", "REJECTED", { supplierId }, reason);
  await audit(actorId, "purchase-order.reject", orderId, { reason });
  await notifyParty(orderId, "shop", "Order rejected", `The supplier rejected your order: ${reason}`);
  return o;
}
export async function processOrder(supplierId: string, actorId: string, orderId: string) {
  const o = await transitionOrder(orderId, actorId, "SUPPLIER", "PROCESSING", { supplierId });
  await audit(actorId, "purchase-order.process", orderId);
  return o;
}

export interface ShipInput { estimatedAt?: Date; tracking?: string; items?: { itemId: string; expiryDate: string; lotCode?: string }[] }

export async function shipOrder(supplierId: string, actorId: string, orderId: string, input: ShipInput = {}) {
  const hook: OrderHook = async (tx, order) => {
    for (const it of input.items ?? []) {
      if (daysUntilExpiry(new Date(it.expiryDate), new Date()) < 0) throw new HttpError(422, "Expiry date is in the past", "EXPIRED_GOODS");
      const r = await tx.purchaseOrderItem.updateMany({ where: { id: it.itemId, orderId: order.id }, data: { expiryDate: new Date(it.expiryDate), lotCode: it.lotCode } });
      if (r.count !== 1) throw new HttpError(422, "Unknown order line in shipment details", "BAD_ITEM");
    }
    // Perishables cannot ship without a declared expiry date.
    const perishable = await tx.product.findMany({ where: { id: { in: order.items.map((i) => i.productId) }, perishable: true }, select: { id: true } });
    const missing = await tx.purchaseOrderItem.count({ where: { orderId: order.id, productId: { in: perishable.map((p) => p.id) }, expiryDate: null } });
    if (missing > 0) throw new HttpError(422, "Expiry date required for every perishable line before shipping", "EXPIRY_REQUIRED");
    await tx.delivery.create({ data: { reference: `DL-${crypto.randomBytes(4).toString("hex").toUpperCase()}`, orderId: order.id, status: "IN_TRANSIT",
      dispatchedAt: new Date(), estimatedAt: input.estimatedAt, tracking: input.tracking } });
  };
  const o = await transitionOrder(orderId, actorId, "SUPPLIER", "SHIPPED", { supplierId }, undefined, hook);
  await audit(actorId, "purchase-order.ship", orderId);
  await notifyParty(orderId, "shop", "Order shipped", "Your order is on its way.");
  return o;
}

export async function deliverOrder(supplierId: string, actorId: string, orderId: string) {
  const o = await transitionOrder(orderId, actorId, "SUPPLIER", "DELIVERED", { supplierId }, undefined, async (tx, order) => {
    await tx.delivery.updateMany({ where: { orderId: order.id, status: "IN_TRANSIT" }, data: { status: "DELIVERED", deliveredAt: new Date() } });
  });
  await audit(actorId, "purchase-order.deliver", orderId);
  await notifyParty(orderId, "shop", "Order delivered", "The supplier marked your order delivered. Please confirm receipt to update your stock.");
  return o;
}

/** Attach product names/SKUs to order lines for display. */
export async function withProducts<T extends { items: { productId: string }[] }>(order: T) {
  const products = await prisma.product.findMany({ where: { id: { in: order.items.map((i) => i.productId) } }, select: { id: true, sku: true, name: true, perishable: true } });
  const m = new Map(products.map((p) => [p.id, p]));
  return { ...order, items: order.items.map((i) => ({ ...i, product: m.get(i.productId) ?? null })) };
}
