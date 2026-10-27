import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../../src/services/prisma";
import { env } from "../../src/config/env";
import { adjustRecommendation, confirmRecommendation, generateRecommendations, listRecommendations, orderFromRecommendation } from "../../src/modules/recommendations/recommendations.service";
import { createOrder, submitOrder } from "../../src/modules/purchase-orders/po.workflow";
import { day, invQty, makeInventory, makeOffer, makeProduct, makeShop, makeSupplier, uid } from "./fixtures";

beforeAll(() => expect(process.env.DATABASE_URL).toMatch(/_test(\?|$)/));

// Shop selling a steady 5 units/day for 30 days, 10 units in stock, one supplier with a 2-day lead time.
async function setup(opts: { perishable?: boolean; stock?: number; history?: boolean } = {}) {
  const s = await makeShop(); const p = await makeSupplier(); const product = await makeProduct(opts.perishable);
  const inv = await makeInventory(s.shop.id, product.id, opts.stock ?? 10);
  const offer = await makeOffer(p.supplier.id, product.id, { quantity: 100, leadTimeDays: 2 });
  if (opts.history !== false) for (let d = 30; d >= 1; d--)
    await prisma.sale.create({ data: { shopId: s.shop.id, idempotencyKey: `h-${uid()}`, createdById: s.user.id, total: "50.00", soldAt: day(-d),
      items: { create: [{ inventoryId: inv.id, quantity: 5, unitPrice: "10.00", lineTotal: "50.00" }] } } });
  const gen = () => generateRecommendations(s.shop.id, { reviewPeriodDays: 7, defaultLeadTimeDays: 2 });
  return { s, p, product, inv, offer, gen };
}
const one = async (x: Awaited<ReturnType<typeof setup>>) => { const r = await x.gen(); expect(r.generated).toHaveLength(1); return r.generated[0] as { id: string; recommendedQty: number; status: string; suggestedSupplierId: string; assumptions: any }; };

describe("generating recommendations", () => {
  it("calculates the quantity from sales history, stock and lead time, and stores the assumptions", async () => {
    const x = await setup();
    const rec = await one(x);
    // 5/day over (2 lead + 7 review) days = 45, minus 10 on hand, no variance so no safety stock
    expect(rec.recommendedQty).toBe(35);
    expect(rec.status).toBe("PENDING");
    expect(rec.suggestedSupplierId).toBe(x.p.supplier.id);
    expect(rec.assumptions.forecast.method).toBeTruthy();
    expect(rec.assumptions.inputs).toMatchObject({ onHand: 10, leadTimeDays: 2, incomingQuantity: 0 });
    expect(rec.assumptions.supplier.offerId).toBe(x.offer.id);
    expect(await prisma.forecast.count({ where: { shopId: x.s.shop.id } })).toBe(1);
    expect(await prisma.purchaseOrder.count({ where: { shopId: x.s.shop.id } })).toBe(0); // advisory only
    expect(await invQty(x.inv.id)).toBe(10);
  });

  it("skips products with no sales history instead of guessing", async () => {
    const x = await setup({ history: false });
    const r = await x.gen();
    expect(r.generated).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/No sales history/);
  });

  it("counts stock that is already on order", async () => {
    const x = await setup();
    const { order } = await createOrder(x.s.shop.id, x.s.user.id, { supplierId: x.p.supplier.id, idempotencyKey: `k-${uid()}`, items: [{ supplierProductId: x.offer.id, quantity: 10 }] });
    await submitOrder(x.s.shop.id, x.s.user.id, order.id);
    expect((await one(x)).recommendedQty).toBe(25);
  });

  it("does not count perishable stock that will expire before it can be sold", async () => {
    const x = await setup({ perishable: true, stock: 30 });
    await prisma.inventoryBatch.create({ data: { inventoryId: x.inv.id, quantity: 20, receivedQty: 20, expiryDate: day(1) } });
    await prisma.inventoryBatch.create({ data: { inventoryId: x.inv.id, quantity: 10, receivedQty: 10, expiryDate: day(60) } });
    const rec = await one(x);
    expect(rec.assumptions.perishable.projectedWaste).toBe(10);
    expect(rec.recommendedQty).toBe(25); // 45 needed - 20 effectively available (30 on hand - 10 doomed)
  });

  it("replaces earlier open suggestions when regenerated", async () => {
    const x = await setup();
    const first = await one(x); await one(x);
    const all = await listRecommendations(x.s.shop.id);
    expect(all.filter((r) => r.status === "PENDING")).toHaveLength(1);
    expect(all.find((r) => r.id === first.id)!.status).toBe("DISMISSED");
  });

  it("fails clearly when the forecasting service is down and saves nothing", async () => {
    const x = await setup(); const original = env.ML_SERVICE_URL;
    (env as { ML_SERVICE_URL: string }).ML_SERVICE_URL = "http://127.0.0.1:9";
    try { await expect(x.gen()).rejects.toMatchObject({ status: 503, code: "ML_UNAVAILABLE" }); }
    finally { (env as { ML_SERVICE_URL: string }).ML_SERVICE_URL = original; }
    expect(await prisma.recommendation.count({ where: { shopId: x.s.shop.id } })).toBe(0);
  });
});

describe("turning a recommendation into an order", () => {
  it("needs explicit confirmation, then creates only a DRAFT order, once", async () => {
    const x = await setup(); const rec = await one(x);
    await expect(orderFromRecommendation(x.s.shop.id, x.s.user.id, rec.id)).rejects.toThrow(/Cannot order/);
    await confirmRecommendation(x.s.shop.id, rec.id);
    const a = await orderFromRecommendation(x.s.shop.id, x.s.user.id, rec.id);
    const b = await orderFromRecommendation(x.s.shop.id, x.s.user.id, rec.id);
    expect(a.order.id).toBe(b.order.id); expect(b.replayed).toBe(true);
    expect(a.order.status).toBe("DRAFT");
    expect(a.order.items[0].quantity).toBe(35);
    expect(await prisma.purchaseOrder.count({ where: { shopId: x.s.shop.id } })).toBe(1);
    expect(await invQty(x.inv.id)).toBe(10);
    expect((await prisma.recommendation.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe("ORDERED");
  });

  it("uses the owner's adjusted quantity and requires re-confirmation after adjusting", async () => {
    const x = await setup(); const rec = await one(x);
    await confirmRecommendation(x.s.shop.id, rec.id);
    const adjusted = await adjustRecommendation(x.s.shop.id, rec.id, 20);
    expect([adjusted.status, adjusted.adjustedQty]).toEqual(["ADJUSTED", 20]);
    await expect(orderFromRecommendation(x.s.shop.id, x.s.user.id, rec.id)).rejects.toThrow(/Cannot order/);
    await confirmRecommendation(x.s.shop.id, rec.id);
    expect((await orderFromRecommendation(x.s.shop.id, x.s.user.id, rec.id)).order.items[0].quantity).toBe(20);
  });

  it("will not touch another shop's recommendations", async () => {
    const x = await setup(); const rec = await one(x); const other = await makeShop();
    await expect(confirmRecommendation(other.shop.id, rec.id)).rejects.toThrow(/not found/);
    expect((await listRecommendations(other.shop.id))).toHaveLength(0);
  });
});
