import { Router } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../services/prisma";
import { asyncHandler, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole, shopIdOf } from "../../middleware/auth";
import { stockStatus } from "../inventory/stock-math";

const r = Router();
r.use(requireAuth, requireRole("SHOP_OWNER"), requireActive);
const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** One call that powers the shop dashboard. Every figure is computed from stored records. */
r.get("/shop-summary", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req), userId = req.user!.id;
  const now = new Date();
  const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since14 = new Date(startToday.getTime() - 13 * DAY), since30 = new Date(now.getTime() - 30 * DAY);

  const [inv, today, pendingOrders, pendingRecs, trendRows, sold, recentSales, notifications, unread] = await Promise.all([
    prisma.shopInventory.findMany({ where: { shopId, isArchived: false }, include: { product: { select: { name: true, sku: true } } } }),
    prisma.sale.aggregate({ where: { shopId, soldAt: { gte: startToday } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.purchaseOrder.count({ where: { shopId, status: { in: ["SUBMITTED", "ACCEPTED", "PROCESSING", "SHIPPED"] } } }),
    prisma.recommendation.count({ where: { shopId, status: { in: ["PENDING", "ADJUSTED"] } } }),
    prisma.sale.findMany({ where: { shopId, soldAt: { gte: since14 } }, select: { total: true, soldAt: true } }),
    prisma.saleItem.groupBy({ by: ["inventoryId"], where: { sale: { shopId, soldAt: { gte: since30 } } }, _sum: { quantity: true } }),
    prisma.sale.findMany({ where: { shopId }, orderBy: { soldAt: "desc" }, take: 5, include: { _count: { select: { items: true } } } }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  let valuation = new Decimal(0), units = 0, low = 0, out = 0, reorder = 0;
  for (const i of inv) {
    valuation = valuation.add(new Decimal(i.costPrice).mul(i.quantity)); units += i.quantity;
    const st = stockStatus(i.quantity, i.reserved, i.minLevel, i.reorderPoint);
    if (st === "LOW") low++; else if (st === "OUT_OF_STOCK") out++; else if (st === "REORDER") reorder++;
  }
  const soldMap = new Map<string, number>(sold.map((s): [string, number] => [s.inventoryId, s._sum.quantity ?? 0]));
  type Inv = (typeof inv)[number];
  const byId = new Map<string, Inv>(inv.map((i): [string, Inv] => [i.id, i]));

  const trend: Record<string, Decimal> = {};
  for (let t = since14.getTime(); t <= startToday.getTime(); t += DAY) trend[dayKey(new Date(t))] = new Decimal(0);
  for (const s of trendRows) { const k = dayKey(s.soldAt); if (k in trend) trend[k] = trend[k].add(s.total); }

  ok(res, {
    activeProducts: inv.length, totalUnits: units, inventoryValuation: valuation.toString(),
    todaySales: { total: (today._sum.total ?? new Decimal(0)).toString(), count: today._count._all },
    stock: { low, outOfStock: out, needsReorder: reorder }, pendingOrders, pendingRecommendations: pendingRecs,
    salesTrend: Object.entries(trend).map(([date, total]) => ({ date, total: total.toString() })),
    topSelling: [...soldMap.entries()].filter(([id]) => byId.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, qty]) => ({ name: byId.get(id)!.product.name, sku: byId.get(id)!.product.sku, unitsSold: qty })),
    slowMoving: inv.filter((i) => i.quantity > 0).map((i) => ({ name: i.product.name, sku: i.product.sku, onHand: i.quantity, unitsSold30d: soldMap.get(i.id) ?? 0 }))
      .sort((a, b) => a.unitsSold30d - b.unitsSold30d || b.onHand - a.onHand).slice(0, 5),
    recentSales: recentSales.map((s) => ({ id: s.id, total: s.total.toString(), soldAt: s.soldAt, lines: s._count.items })),
    notifications: { unread, items: notifications },
  });
}));

export default r;
