import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole, shopIdOf } from "../../middleware/auth";
import { reliabilityMap } from "../purchase-orders/supplier-stats";
import { distanceKm } from "../../utils/geo";
import { mlPost } from "../../services/ml-client";

const r = Router();
r.use(requireAuth, requireRole("SHOP_OWNER"), requireActive);

// Search suppliers (only verified, active accounts are eligible).
r.get("/", asyncHandler(async (req, res) => {
  const q = z.object({ q: z.string().trim().max(80).optional(), categoryId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
  const where = { owner: { status: "ACTIVE" as const }, ...(q.q ? { name: { contains: q.q, mode: "insensitive" as const } } : {}),
    products: { some: { isActive: true, quantity: { gt: 0 }, ...(q.categoryId ? { product: { categoryId: q.categoryId } } : {}) } } };
  const [total, rows] = await Promise.all([prisma.supplier.count({ where }),
    prisma.supplier.findMany({ where, orderBy: { name: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, name: true, address: true } })]);
  const rel = await reliabilityMap(rows.map((s) => s.id));
  ok(res, { total, page: q.page, pageSize: q.pageSize, items: rows.map((s) => ({ ...s, verified: true, reliability: rel.get(s.id) ?? null })) });
}));

const weight = z.coerce.number().min(0).max(100).optional();
const offersQuery = z.object({
  productId: z.string().min(1), quantity: z.coerce.number().int().min(1).default(1),
  maxPrice: z.coerce.number().positive().optional(), maxLeadDays: z.coerce.number().int().min(0).optional(), q: z.string().trim().max(80).optional(),
  wPrice: weight, wAvailability: weight, wDelivery: weight, wReliability: weight, wDistance: weight,
});

// Compare real supplier offers for one product, ranked by the ML service with configurable weights.
r.get("/offers", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req);
  const q = offersQuery.parse(req.query);
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const offers = await prisma.supplierProduct.findMany({ include: { supplier: true }, where: {
    productId: q.productId, isActive: true, quantity: { gt: 0 }, supplier: { owner: { status: "ACTIVE" }, ...(q.q ? { name: { contains: q.q, mode: "insensitive" } } : {}) },
    ...(q.maxPrice ? { unitPrice: { lte: q.maxPrice } } : {}), ...(q.maxLeadDays != null ? { leadTimeDays: { lte: q.maxLeadDays } } : {}) } });
  const rel = await reliabilityMap(Array.from(new Set(offers.map((o) => o.supplierId as string))));
  const rows = offers.map((o) => ({ o, rel: rel.get(o.supplierId) ?? null, dist: distanceKm(shop, o.supplier) }));
  const base = (x: (typeof rows)[number]) => ({ offerId: x.o.id, supplierId: x.o.supplierId, supplierName: x.o.supplier.name, verified: true,
    unitPrice: x.o.unitPrice, availableQuantity: x.o.quantity, minOrderQty: x.o.minOrderQty, leadTimeDays: x.o.leadTimeDays, reliability: x.rel, distanceKm: x.dist });

  const w = { price: q.wPrice, availability: q.wAvailability, delivery: q.wDelivery, reliability: q.wReliability, distance: q.wDistance };
  const weights = Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined));
  try {
    const ml = await mlPost<{ ranked: { offer_id: string; score: number; rank: number; factor_scores: object; contributions: object; explanation: string }[];
      effective_weights: object; notes: string[] }>("/ml/supplier-rank", {
      required_quantity: q.quantity, ...(Object.keys(weights).length ? { weights } : {}),
      offers: rows.map((x) => ({ offer_id: x.o.id, supplier_id: x.o.supplierId, unit_price: Number(x.o.unitPrice), available_quantity: x.o.quantity,
        lead_time_days: x.o.leadTimeDays, reliability: x.rel, distance_km: x.dist })) });
    const byId = new Map(rows.map((x) => [x.o.id, x]));
    ok(res, { ranking: { available: true, effectiveWeights: ml.effective_weights, notes: ml.notes },
      offers: ml.ranked.map((m) => ({ ...base(byId.get(m.offer_id)!), rank: m.rank, score: m.score, factorScores: m.factor_scores, contributions: m.contributions, explanation: m.explanation })) });
  } catch (e) { // ranking is advisory: fall back to a price-sorted list instead of failing
    ok(res, { ranking: { available: false, reason: "Ranking service unavailable; sorted by price" },
      offers: rows.map(base).sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice)) });
  }
}));

r.get("/:id", asyncHandler(async (req, res) => {
  const s = await prisma.supplier.findFirst({ where: { id: req.params.id, owner: { status: "ACTIVE" } },
    select: { id: true, name: true, address: true, products: { where: { isActive: true, quantity: { gt: 0 } }, select: { id: true, unitPrice: true, quantity: true, leadTimeDays: true, minOrderQty: true, product: { select: { id: true, sku: true, name: true } } } } } });
  if (!s) throw new HttpError(404, "Supplier not found", "NOT_FOUND");
  ok(res, { ...s, verified: true, reliability: (await reliabilityMap([s.id])).get(s.id) ?? null });
}));

export default r;
