import { describe, it, expect, beforeAll } from "vitest";
import { POStatus } from "@prisma/client";
import { prisma } from "../../src/services/prisma";
import { recordSale } from "../../src/modules/inventory/sales.service";
import { receiveOrder, transitionOrder } from "../../src/modules/purchase-orders/po.service";
import { writeOffExpired } from "../../src/modules/inventory/expiry.service";
import { InsufficientStockError } from "../../src/modules/inventory/stock-math";

const uid = () => Math.random().toString(36).slice(2, 10);
const day = (n: number) => new Date(Date.now() + n * 86_400_000);
let categoryId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/_test(\?|$)/); // safety: never run against the real database
  categoryId = (await prisma.category.create({ data: { name: `cat-${uid()}` } })).id;
});

async function makeShop() {
  const user = await prisma.user.create({ data: { email: `s-${uid()}@t.test`, passwordHash: "x", name: "T", role: "SHOP_OWNER", status: "ACTIVE",
    shop: { create: { name: "Test shop" } } }, include: { shop: true } });
  return { user, shop: user.shop! };
}
async function makeSupplier() {
  const u = await prisma.user.create({ data: { email: `p-${uid()}@t.test`, passwordHash: "x", name: "S", role: "SUPPLIER", status: "ACTIVE",
    supplier: { create: { name: "Test supplier" } } }, include: { supplier: true } });
  return u.supplier!;
}
async function makeInventory(shopId: string, qty: number, perishable = false) {
  const product = await prisma.product.create({ data: { sku: `T-${uid()}`, name: "Test item", categoryId, perishable } });
  const inv = await prisma.shopInventory.create({ data: { shopId, productId: product.id, quantity: qty, costPrice: "5.00", sellingPrice: "10.00" } });
  return { product, inv };
}
const addBatch = (inventoryId: string, quantity: number, offsetDays: number) =>
  prisma.inventoryBatch.create({ data: { inventoryId, quantity, receivedQty: quantity, expiryDate: day(offsetDays), lotCode: `L${uid()}` } });
async function makeOrder(shopId: string, supplierId: string, productId: string, qty: number, status: POStatus, expiry?: Date) {
  const sp = await prisma.supplierProduct.create({ data: { supplierId, productId, unitPrice: "4.00", quantity: 1000 } });
  return prisma.purchaseOrder.create({ include: { items: true }, data: { number: `PO-${uid()}`, shopId, supplierId, status, total: String(qty * 4),
    items: { create: [{ supplierProductId: sp.id, productId, quantity: qty, unitPrice: "4.00", lineTotal: String(qty * 4), expiryDate: expiry ?? null }] } } });
}
const sellOne = (shopId: string, userId: string, inventoryId: string, quantity: number, key = `k-${uid()}`) =>
  recordSale(shopId, userId, { idempotencyKey: key, items: [{ inventoryId, quantity, unitPrice: "10.00" }] });
const qtyOf = async (id: string) => (await prisma.shopInventory.findUniqueOrThrow({ where: { id } })).quantity;

describe("sales", () => {
  it("decreases stock and records a movement", async () => {
    const { user, shop } = await makeShop(); const { inv } = await makeInventory(shop.id, 10);
    const { sale } = await sellOne(shop.id, user.id, inv.id, 3);
    expect(await qtyOf(inv.id)).toBe(7);
    expect(sale.total.toString()).toBe("30");
    expect(await prisma.stockMovement.count({ where: { inventoryId: inv.id, type: "SALE", delta: -3 } })).toBe(1);
  });

  it("never oversells under concurrent requests", async () => {
    const { user, shop } = await makeShop(); const { inv } = await makeInventory(shop.id, 10);
    const res = await Promise.allSettled([sellOne(shop.id, user.id, inv.id, 6), sellOne(shop.id, user.id, inv.id, 6)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientStockError);
    expect(await qtyOf(inv.id)).toBe(4);
  });

  it("processes a retried request (same idempotency key) only once", async () => {
    const { user, shop } = await makeShop(); const { inv } = await makeInventory(shop.id, 10);
    const key = `k-${uid()}`;
    const [a, b] = await Promise.all([sellOne(shop.id, user.id, inv.id, 2, key), sellOne(shop.id, user.id, inv.id, 2, key)]);
    expect(a.sale.id).toBe(b.sale.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await qtyOf(inv.id)).toBe(8);
  });

  it("cannot sell another shop's inventory", async () => {
    const mine = await makeShop(); const theirs = await makeShop(); const { inv } = await makeInventory(theirs.shop.id, 10);
    await expect(sellOne(mine.shop.id, mine.user.id, inv.id, 1)).rejects.toThrow(/not found for this shop/);
    expect(await qtyOf(inv.id)).toBe(10);
  });
});

describe("purchase orders", () => {
  it("replenishes stock exactly once even if received twice at the same time", async () => {
    const { user, shop } = await makeShop(); const sup = await makeSupplier(); const { product, inv } = await makeInventory(shop.id, 5);
    const order = await makeOrder(shop.id, sup.id, product.id, 25, "SHIPPED");
    const res = await Promise.all([receiveOrder(order.id, shop.id, user.id), receiveOrder(order.id, shop.id, user.id)]);
    expect(res.map((r) => r.alreadyReceived).sort()).toEqual([false, true]);
    expect(await qtyOf(inv.id)).toBe(30);
    expect(await prisma.stockMovement.count({ where: { inventoryId: inv.id, type: "PURCHASE_RECEIPT" } })).toBe(1);
    expect((await receiveOrder(order.id, shop.id, user.id)).alreadyReceived).toBe(true); // later retry is also a no-op
    expect(await qtyOf(inv.id)).toBe(30);
  });

  it("refuses to receive an order that has not shipped", async () => {
    const { user, shop } = await makeShop(); const sup = await makeSupplier(); const { product, inv } = await makeInventory(shop.id, 5);
    const order = await makeOrder(shop.id, sup.id, product.id, 10, "ACCEPTED");
    await expect(receiveOrder(order.id, shop.id, user.id)).rejects.toThrow(/cannot be received/);
    expect(await qtyOf(inv.id)).toBe(5);
  });

  it("lets only one of two simultaneous transitions win", async () => {
    const { shop } = await makeShop(); const sup = await makeSupplier(); const { product } = await makeInventory(shop.id, 5);
    const order = await makeOrder(shop.id, sup.id, product.id, 10, "SUBMITTED");
    const go = () => transitionOrder(order.id, "actor", "SUPPLIER", "ACCEPTED", { supplierId: sup.id });
    const res = await Promise.allSettled([go(), go()]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.pOStatusHistory.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("hides orders from other suppliers", async () => {
    const { shop } = await makeShop(); const sup = await makeSupplier(); const other = await makeSupplier(); const { product } = await makeInventory(shop.id, 1);
    const order = await makeOrder(shop.id, sup.id, product.id, 5, "SUBMITTED");
    await expect(transitionOrder(order.id, "a", "SUPPLIER", "ACCEPTED", { supplierId: other.id })).rejects.toThrow(/not found/);
  });
});

describe("perishables and expiry", () => {
  it("requires an expiry date when receiving perishables, and rolls the receipt back", async () => {
    const { user, shop } = await makeShop(); const sup = await makeSupplier(); const { product, inv } = await makeInventory(shop.id, 0, true);
    const order = await makeOrder(shop.id, sup.id, product.id, 20, "SHIPPED");
    await expect(receiveOrder(order.id, shop.id, user.id)).rejects.toThrow(/Expiry date required/);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).receivedAt).toBeNull();
    expect(await qtyOf(inv.id)).toBe(0);
    const ok = await receiveOrder(order.id, shop.id, user.id, { [order.items[0].id]: day(10).toISOString().slice(0, 10) });
    expect(ok.alreadyReceived).toBe(false);
    expect(await qtyOf(inv.id)).toBe(20);
    expect(await prisma.inventoryBatch.count({ where: { inventoryId: inv.id, quantity: 20 } })).toBe(1);
  });

  it("rejects delivery of already-expired goods", async () => {
    const { user, shop } = await makeShop(); const sup = await makeSupplier(); const { product, inv } = await makeInventory(shop.id, 0, true);
    const order = await makeOrder(shop.id, sup.id, product.id, 5, "SHIPPED", day(-2));
    await expect(receiveOrder(order.id, shop.id, user.id)).rejects.toThrow(/already expired/);
    expect(await qtyOf(inv.id)).toBe(0);
  });

  it("sells earliest-expiring stock first and never from expired batches", async () => {
    const { user, shop } = await makeShop(); const { inv } = await makeInventory(shop.id, 15, true);
    const expired = await addBatch(inv.id, 5, -1); const early = await addBatch(inv.id, 4, 2); const late = await addBatch(inv.id, 6, 20);
    await sellOne(shop.id, user.id, inv.id, 7);
    const left = async (id: string) => (await prisma.inventoryBatch.findUniqueOrThrow({ where: { id } })).quantity;
    expect([await left(expired.id), await left(early.id), await left(late.id)]).toEqual([5, 0, 3]);
    await expect(sellOne(shop.id, user.id, inv.id, 4)).rejects.toBeInstanceOf(InsufficientStockError); // only 3 sellable
    expect(await qtyOf(inv.id)).toBe(8);
  });

  it("writes off expired stock once, only for expired batches in the caller's shop", async () => {
    const { user, shop } = await makeShop(); const other = await makeShop(); const { inv } = await makeInventory(shop.id, 10, true);
    const expired = await addBatch(inv.id, 5, -3); const fresh = await addBatch(inv.id, 5, 3);
    expect((await writeOffExpired(other.shop.id, other.user.id, [expired.id], "x-shop")).unitsWrittenOff).toBe(0);
    expect((await writeOffExpired(shop.id, user.id, [expired.id, fresh.id], "spoiled")).unitsWrittenOff).toBe(5);
    expect((await writeOffExpired(shop.id, user.id, [expired.id, fresh.id], "again")).unitsWrittenOff).toBe(0);
    expect(await qtyOf(inv.id)).toBe(5);
    expect(await prisma.stockMovement.count({ where: { inventoryId: inv.id, type: "EXPIRY_WRITE_OFF" } })).toBe(1);
    await expect(writeOffExpired(shop.id, user.id, [expired.id], " ")).rejects.toThrow(/reason/);
  });
});
