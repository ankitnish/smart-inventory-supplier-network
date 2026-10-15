import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../../src/services/prisma";
import { acceptOrder, cancelOrder, createOrder, deliverOrder, processOrder, receiveGoods, rejectOrder, shipOrder, submitOrder } from "../../src/modules/purchase-orders/po.workflow";
import { InvalidTransitionError } from "../../src/modules/purchase-orders/state-machine";
import { invQty, iso, makeInventory, makeOffer, makeProduct, makeShop, makeSupplier, offerQty, statusOf, uid } from "./fixtures";

beforeAll(() => expect(process.env.DATABASE_URL).toMatch(/_test(\?|$)/)); // never run against the real database

/** A shop, a supplier, one product listed by both sides, ready to order. */
async function setup(opts: { perishable?: boolean; offerQty?: number; shopQty?: number; minOrderQty?: number } = {}) {
  const s = await makeShop(); const p = await makeSupplier(); const product = await makeProduct(opts.perishable);
  const inv = await makeInventory(s.shop.id, product.id, opts.shopQty ?? 5);
  const offer = await makeOffer(p.supplier.id, product.id, { quantity: opts.offerQty ?? 100, minOrderQty: opts.minOrderQty ?? 1 });
  const place = (qty: number, key = `k-${uid()}`) => createOrder(s.shop.id, s.user.id, { supplierId: p.supplier.id, idempotencyKey: key, items: [{ supplierProductId: offer.id, quantity: qty }] });
  const submitted = async (qty: number) => { const { order } = await place(qty); await submitOrder(s.shop.id, s.user.id, order.id); return order; };
  return { s, p, product, inv, offer, place, submitted };
}

describe("creating orders", () => {
  it("takes prices from the supplier's offer and totals with exact decimals", async () => {
    const { place } = await setup();
    const { order } = await place(20);
    expect(order.status).toBe("DRAFT");
    expect(order.total.toString()).toBe("80");
    expect(order.items[0].unitPrice.toString()).toBe("4");
  });

  it("returns the same order for a retried request", async () => {
    const { s, place } = await setup(); const key = `k-${uid()}`;
    const [a, b] = await Promise.all([place(5, key), place(5, key)]);
    expect(a.order.id).toBe(b.order.id);
    expect(await prisma.purchaseOrder.count({ where: { shopId: s.shop.id } })).toBe(1);
  });

  it("rejects bad requests", async () => {
    const x = await setup({ minOrderQty: 10, offerQty: 50 });
    await expect(x.place(5)).rejects.toThrow(/Minimum order/);
    await expect(x.place(60)).rejects.toThrow(/only 50 available/);
    const other = await makeSupplier(); // an offer that belongs to a different supplier
    const foreign = await makeOffer(other.supplier.id, x.product.id);
    await expect(createOrder(x.s.shop.id, x.s.user.id, { supplierId: x.p.supplier.id, idempotencyKey: `k-${uid()}`, items: [{ supplierProductId: foreign.id, quantity: 10 }] })).rejects.toThrow(/unavailable or belong/);
    await prisma.supplierProduct.update({ where: { id: x.offer.id }, data: { isActive: false } });
    await expect(x.place(10)).rejects.toThrow(/unavailable/);
  });

  it("requires the product to be in the shop's inventory", async () => {
    const s = await makeShop(); const p = await makeSupplier(); const product = await makeProduct(); const offer = await makeOffer(p.supplier.id, product.id);
    await expect(createOrder(s.shop.id, s.user.id, { supplierId: p.supplier.id, idempotencyKey: `k-${uid()}`, items: [{ supplierProductId: offer.id, quantity: 1 }] })).rejects.toThrow(/inventory/);
  });
});

describe("full order lifecycle", () => {
  it("runs create to receive, moving supplier and shop stock correctly", async () => {
    const x = await setup();
    const order = await x.submitted(20);
    await acceptOrder(x.p.supplier.id, x.p.user.id, order.id);
    expect(await offerQty(x.offer.id)).toBe(80);                  // supplier stock reserved on acceptance
    await processOrder(x.p.supplier.id, x.p.user.id, order.id);
    await shipOrder(x.p.supplier.id, x.p.user.id, order.id, { tracking: "TRK1" });
    expect(await prisma.delivery.count({ where: { orderId: order.id, status: "IN_TRANSIT" } })).toBe(1);
    await deliverOrder(x.p.supplier.id, x.p.user.id, order.id);
    expect(await invQty(x.inv.id)).toBe(5);                       // supplier saying "delivered" does not add shop stock
    const r = await receiveGoods(x.s.shop.id, x.s.user.id, order.id);
    expect(r.alreadyReceived).toBe(false);
    expect(await invQty(x.inv.id)).toBe(25);
    expect((await receiveGoods(x.s.shop.id, x.s.user.id, order.id)).alreadyReceived).toBe(true);
    expect(await invQty(x.inv.id)).toBe(25);                      // still once
    expect(await statusOf(order.id)).toBe("DELIVERED");
    expect((await prisma.delivery.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("DELIVERED");
  });

  it("notifies the other party at each step", async () => {
    const x = await setup();
    const order = await x.submitted(5);
    expect(await prisma.notification.count({ where: { userId: x.p.user.id, type: "purchase-order.updated" } })).toBe(1);
    await acceptOrder(x.p.supplier.id, x.p.user.id, order.id);
    expect(await prisma.notification.count({ where: { userId: x.s.user.id, type: "purchase-order.updated" } })).toBe(1);
  });

  it("blocks skipped states and the wrong party", async () => {
    const x = await setup(); const order = await x.submitted(5);
    await expect(shipOrder(x.p.supplier.id, x.p.user.id, order.id)).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(receiveGoods(x.s.shop.id, x.s.user.id, order.id)).rejects.toThrow(/cannot be received/);
    const stranger = await makeSupplier();
    await expect(acceptOrder(stranger.supplier.id, stranger.user.id, order.id)).rejects.toThrow(/not found/);
    expect(await statusOf(order.id)).toBe("SUBMITTED");
  });
});

describe("supplier stock reservation", () => {
  it("refuses to accept an order the supplier can no longer fill, leaving it submitted", async () => {
    const x = await setup({ offerQty: 100 });
    const a = await x.submitted(60); const b = await x.submitted(60);
    await acceptOrder(x.p.supplier.id, x.p.user.id, a.id);
    await expect(acceptOrder(x.p.supplier.id, x.p.user.id, b.id)).rejects.toThrow(/Insufficient supplier stock/);
    expect(await statusOf(b.id)).toBe("SUBMITTED");
    expect(await offerQty(x.offer.id)).toBe(40);
  });

  it("cannot double-promise stock when two orders are accepted at the same time", async () => {
    const x = await setup({ offerQty: 100 });
    const a = await x.submitted(60); const b = await x.submitted(60);
    const res = await Promise.allSettled([acceptOrder(x.p.supplier.id, x.p.user.id, a.id), acceptOrder(x.p.supplier.id, x.p.user.id, b.id)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await offerQty(x.offer.id)).toBe(40);
  });

  it("releases reserved stock if the shop cancels after acceptance, but not after processing starts", async () => {
    const x = await setup();
    const a = await x.submitted(30);
    await acceptOrder(x.p.supplier.id, x.p.user.id, a.id);
    expect(await offerQty(x.offer.id)).toBe(70);
    await cancelOrder(x.s.shop.id, x.s.user.id, a.id);
    expect(await offerQty(x.offer.id)).toBe(100);
    expect(await statusOf(a.id)).toBe("CANCELLED");
    const b = await x.submitted(10);
    await acceptOrder(x.p.supplier.id, x.p.user.id, b.id); await processOrder(x.p.supplier.id, x.p.user.id, b.id);
    await expect(cancelOrder(x.s.shop.id, x.s.user.id, b.id)).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await offerQty(x.offer.id)).toBe(90);
  });

  it("requires a reason to reject and reserves nothing", async () => {
    const x = await setup(); const o = await x.submitted(10);
    await expect(rejectOrder(x.p.supplier.id, x.p.user.id, o.id, " ")).rejects.toThrow(/reason/);
    await rejectOrder(x.p.supplier.id, x.p.user.id, o.id, "Out of season");
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: o.id } })).rejectionReason).toBe("Out of season");
    expect(await offerQty(x.offer.id)).toBe(100);
  });
});

describe("perishable shipments", () => {
  it("cannot ship without expiry dates; supplier's dates flow into a stock batch at receipt", async () => {
    const x = await setup({ perishable: true, shopQty: 0 });
    const o = await x.submitted(12);
    await acceptOrder(x.p.supplier.id, x.p.user.id, o.id); await processOrder(x.p.supplier.id, x.p.user.id, o.id);
    await expect(shipOrder(x.p.supplier.id, x.p.user.id, o.id)).rejects.toThrow(/Expiry date required/);
    expect(await statusOf(o.id)).toBe("PROCESSING");              // failed shipment rolled back fully
    expect(await prisma.delivery.count({ where: { orderId: o.id } })).toBe(0);
    await expect(shipOrder(x.p.supplier.id, x.p.user.id, o.id, { items: [{ itemId: o.items[0].id, expiryDate: iso(-1) }] })).rejects.toThrow(/in the past/);
    await shipOrder(x.p.supplier.id, x.p.user.id, o.id, { items: [{ itemId: o.items[0].id, expiryDate: iso(14), lotCode: "LOT-9" }] });
    await receiveGoods(x.s.shop.id, x.s.user.id, o.id);          // no overrides needed
    expect(await invQty(x.inv.id)).toBe(12);
    const batch = await prisma.inventoryBatch.findFirstOrThrow({ where: { inventoryId: x.inv.id } });
    expect([batch.quantity, batch.lotCode]).toEqual([12, "LOT-9"]);
  });
});
