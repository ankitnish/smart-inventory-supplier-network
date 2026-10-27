import { Prisma } from "@prisma/client";
import { prisma } from "../../services/prisma";
import { mlPost } from "../../services/ml-client";
import { HttpError } from "../../utils/http";
import { distanceKm } from "../../utils/geo";
import { effectiveAvailable, expiredQuantity, projectedWaste, sellableQuantity } from "../inventory/expiry";
import { reliabilityMap } from "../purchase-orders/supplier-stats";
import { createOrder } from "../purchase-orders/po.workflow";
import { buildReorderPayload, nextRecStatus, RecAction, riskFromMl, toDailyPairs } from "./recommendation-rules";

export interface GenerateOptions { productIds?: string[]; reviewPeriodDays?: number; defaultLeadTimeDays?: number; serviceLevelZ?: number; historyDays?: number }
const OPEN_ORDER_STATUSES = ["SUBMITTED", "ACCEPTED", "PROCESSING", "SHIPPED"] as const; // ordered but not yet received

interface MlForecast { method: string; method_version: string; horizon_days: number; daily_forecast: number[]; total_forecast: number; daily_std: number;
  history_days: number; validation: unknown[]; fallback_reason: string | null; generated_at: string }
interface MlStockout { days_remaining: number | null; stockout_before_replenishment: boolean; risk_level: string; explanation: string; assumptions: object }
interface MlReorder { recommended_quantity: number; suggested_order_in_days: number; risk_level: string; safety_stock: number; demand_over_horizon: number; explanation: string; assumptions: object }
interface MlRank { ranked: { offer_id: string; score: number; rank: number; factor_scores: object; contributions: object }[]; effective_weights: object; notes: string[] }

/** The ML service is required for recommendations. If it is down we fail clearly instead of inventing numbers. */
async function ml<T>(path: string, body: unknown): Promise<T> {
  try { return await mlPost<T>(path, body, 8000); }
  catch { throw new HttpError(503, "The forecasting service is unavailable. No recommendations were generated.", "ML_UNAVAILABLE"); }
}

export async function generateRecommendations(shopId: string, opts: GenerateOptions = {}) {
  const review = opts.reviewPeriodDays ?? 7, defaultLead = opts.defaultLeadTimeDays ?? 3, z = opts.serviceLevelZ ?? 1.65, historyDays = opts.historyDays ?? 90;
  const now = new Date();
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const items = await prisma.shopInventory.findMany({ take: 100, orderBy: { updatedAt: "asc" },
    where: { shopId, isArchived: false, ...(opts.productIds?.length ? { productId: { in: opts.productIds } } : {}) },
    include: { product: true, batches: { where: { quantity: { gt: 0 } } } } });
  if (!items.length) return { generated: [], skipped: [] };

  const saleRows = await prisma.saleItem.findMany({ where: { inventoryId: { in: items.map((i) => i.id) }, sale: { shopId, soldAt: { gte: new Date(now.getTime() - historyDays * 86_400_000) } } },
    select: { inventoryId: true, quantity: true, sale: { select: { soldAt: true } } } });
  const incoming = await prisma.purchaseOrderItem.findMany({ where: { productId: { in: items.map((i) => i.productId) }, order: { shopId, status: { in: [...OPEN_ORDER_STATUSES] }, receivedAt: null } }, select: { productId: true, quantity: true } });

  const generated: unknown[] = [], skipped: { inventoryId: string; name: string; reason: string }[] = [];
  for (const item of items) {
    const name = item.product.name;
    const history = toDailyPairs(saleRows.filter((s) => s.inventoryId === item.id).map((s) => ({ quantity: s.quantity, soldAt: s.sale.soldAt })), now);
    if (!history.length) { skipped.push({ inventoryId: item.id, name, reason: "No sales history in the selected window" }); continue; }

    const horizon = Math.min(90, Math.ceil(defaultLead + review));
    const forecast = await ml<MlForecast>("/ml/forecast", { product_id: item.productId, history, horizon_days: horizon });
    const dailyDemand = forecast.total_forecast / forecast.horizon_days; // demand is modelled as the forecast's daily mean

    // Stock the planner may count: for perishables, sellable stock minus units projected to expire unsold.
    const isPerishable = item.product.perishable;
    const effective = isPerishable ? effectiveAvailable(item.batches, dailyDemand, now) : Math.max(0, item.quantity - item.reserved);
    const incomingQty = incoming.filter((i) => i.productId === item.productId).reduce((n, i) => n + i.quantity, 0);

    // Candidate suppliers: real, active offers from verified suppliers.
    const offers = await prisma.supplierProduct.findMany({ where: { productId: item.productId, isActive: true, quantity: { gt: 0 }, supplier: { owner: { status: "ACTIVE" } } }, include: { supplier: true } });
    let best: (typeof offers)[number] | undefined, ranking: { rank: number; score: number; notes: string[] } | undefined;
    if (offers.length) {
      const roughNeed = Math.max(1, Math.ceil(dailyDemand * (defaultLead + review) - effective - incomingQty));
      const rel = await reliabilityMap(Array.from(new Set(offers.map((o) => o.supplierId))));
      const ranked = await ml<MlRank>("/ml/supplier-rank", { required_quantity: roughNeed, offers: offers.map((o) => ({ offer_id: o.id, supplier_id: o.supplierId,
        unit_price: Number(o.unitPrice), available_quantity: o.quantity, lead_time_days: o.leadTimeDays, reliability: rel.get(o.supplierId) ?? null, distance_km: distanceKm(shop, o.supplier) })) });
      const top = ranked.ranked[0];
      if (top) { best = offers.find((o) => o.id === top.offer_id); ranking = { rank: top.rank, score: top.score, notes: ranked.notes }; }
    }
    const leadTime = best?.leadTimeDays ?? defaultLead;

    const reorder = await ml<MlReorder>("/ml/reorder", buildReorderPayload({ productId: item.productId, availableStock: effective, dailyDemand,
      dailyDemandStd: forecast.daily_std, leadTimeDays: leadTime, reviewPeriodDays: review, serviceLevelZ: z, incomingQuantity: incomingQty,
      minOrderQty: best?.minOrderQty, maxOrderQty: best?.quantity }));
    const stockout = await ml<MlStockout>("/ml/stockout", { product_id: item.productId, available_stock: effective, daily_demand: dailyDemand, lead_time_days: leadTime });

    await prisma.forecast.create({ data: { shopId, productId: item.productId, method: forecast.method, methodVersion: forecast.method_version, horizonDays: forecast.horizon_days,
      totalDemand: forecast.total_forecast, dailyValues: forecast.daily_forecast, validation: forecast.validation as Prisma.InputJsonValue } });

    if (reorder.recommended_quantity <= 0) { skipped.push({ inventoryId: item.id, name, reason: "Current and incoming stock cover the planning horizon" }); continue; }

    const orderDate = new Date(now.getTime() + reorder.suggested_order_in_days * 86_400_000);
    const waste = isPerishable ? projectedWaste(item.batches, dailyDemand, now) : 0;
    const assumptions = {
      generatedAt: now.toISOString(), source: "ml-service", methodVersion: forecast.method_version,
      inputs: { reviewPeriodDays: review, defaultLeadTimeDays: defaultLead, serviceLevelZ: z, historyDays, historyDaysUsed: forecast.history_days, onHand: item.quantity, reserved: item.reserved,
        effectiveAvailable: Math.round(effective * 100) / 100, incomingQuantity: incomingQty, dailyDemand: Math.round(dailyDemand * 1000) / 1000, dailyDemandStd: Math.round(forecast.daily_std * 1000) / 1000, leadTimeDays: leadTime },
      forecast: { method: forecast.method, horizonDays: forecast.horizon_days, totalDemand: forecast.total_forecast, validation: forecast.validation, fallbackReason: forecast.fallback_reason },
      stockout: { daysRemaining: stockout.days_remaining, beforeReplenishment: stockout.stockout_before_replenishment, risk: stockout.risk_level, explanation: stockout.explanation },
      reorder: { quantity: reorder.recommended_quantity, safetyStock: reorder.safety_stock, demandOverHorizon: reorder.demand_over_horizon, suggestedOrderInDays: reorder.suggested_order_in_days, ml: reorder.assumptions },
      suggestedOrderDate: orderDate.toISOString().slice(0, 10),
      supplier: best ? { supplierId: best.supplierId, name: best.supplier.name, offerId: best.id, unitPrice: best.unitPrice.toString(), leadTimeDays: best.leadTimeDays, minOrderQty: best.minOrderQty, availableQuantity: best.quantity, ...ranking } : null,
      ...(isPerishable ? { perishable: { sellableQuantity: sellableQuantity(item.batches, now), expiredQuantity: expiredQuantity(item.batches, now), projectedWaste: waste } } : {}),
    };
    const explanation = [reorder.explanation,
      best ? `Suggested supplier: ${best.supplier.name} (${best.leadTimeDays}-day lead time).` : "No eligible supplier currently lists this product, so an order cannot be created until one does.",
      isPerishable && waste > 0 ? `${waste} units are projected to expire before they can be sold, so they were not counted as available.` : ""].filter(Boolean).join(" ");

    const rec = await prisma.$transaction(async (tx) => {
      // Re-generating replaces earlier open suggestions for the product; confirmed ones are kept (the owner approved them).
      await tx.recommendation.updateMany({ where: { shopId, productId: item.productId, status: { in: ["PENDING", "ADJUSTED"] } }, data: { status: "DISMISSED" } });
      return tx.recommendation.create({ data: { shopId, productId: item.productId, recommendedQty: reorder.recommended_quantity, suggestedSupplierId: best?.supplierId,
        risk: riskFromMl(reorder.risk_level), explanation, assumptions: assumptions as Prisma.InputJsonValue } });
    });
    generated.push({ ...rec, productName: name, sku: item.product.sku });
  }
  return { generated, skipped };
}

export async function listRecommendations(shopId: string, status?: string) {
  const recs = await prisma.recommendation.findMany({ where: { shopId, ...(status ? { status: status as never } : {}) }, orderBy: { generatedAt: "desc" }, take: 200 });
  const products = await prisma.product.findMany({ where: { id: { in: recs.map((r) => r.productId) } }, select: { id: true, name: true, sku: true } });
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: recs.flatMap((r) => (r.suggestedSupplierId ? [r.suggestedSupplierId] : [])) } }, select: { id: true, name: true } });
  return recs.map((r) => ({ ...r, product: products.find((p) => p.id === r.productId) ?? null, supplier: suppliers.find((s) => s.id === r.suggestedSupplierId) ?? null }));
}

async function move(shopId: string, id: string, action: RecAction, data: { adjustedQty?: number } = {}) {
  const rec = await prisma.recommendation.findFirst({ where: { id, shopId } });
  if (!rec) throw new HttpError(404, "Recommendation not found", "NOT_FOUND");
  const to = nextRecStatus(rec.status, action);
  const done = await prisma.recommendation.updateMany({ where: { id, shopId, status: rec.status }, data: { status: to, ...data } }); // compare-and-set
  if (done.count !== 1) throw new HttpError(409, "Recommendation changed; reload and try again", "CONFLICT");
  return prisma.recommendation.findUniqueOrThrow({ where: { id } });
}
export const adjustRecommendation = (shopId: string, id: string, adjustedQty: number) => move(shopId, id, "adjust", { adjustedQty });
export const confirmRecommendation = (shopId: string, id: string) => move(shopId, id, "confirm");
export const dismissRecommendation = (shopId: string, id: string) => move(shopId, id, "dismiss");

/** Creates a DRAFT purchase order from a confirmed recommendation. It is never submitted automatically. Safe to retry. */
export async function orderFromRecommendation(shopId: string, actorId: string, id: string) {
  const rec = await prisma.recommendation.findFirst({ where: { id, shopId } });
  if (!rec) throw new HttpError(404, "Recommendation not found", "NOT_FOUND");
  const key = `rec-${rec.id}`;
  if (rec.status === "ORDERED") { // retry: return the order created the first time
    const existing = await prisma.purchaseOrder.findUnique({ where: { shopId_idempotencyKey: { shopId, idempotencyKey: key } }, include: { items: true } });
    if (existing) return { order: existing, replayed: true };
  }
  nextRecStatus(rec.status, "order"); // throws unless the owner has confirmed it
  if (!rec.suggestedSupplierId) throw new HttpError(422, "No supplier was suggested for this recommendation", "NO_SUPPLIER");
  const offer = await prisma.supplierProduct.findUnique({ where: { supplierId_productId: { supplierId: rec.suggestedSupplierId, productId: rec.productId } } });
  if (!offer) throw new HttpError(422, "The suggested supplier no longer lists this product", "OFFER_GONE");
  const { order, replayed } = await createOrder(shopId, actorId, { supplierId: rec.suggestedSupplierId, idempotencyKey: key, items: [{ supplierProductId: offer.id, quantity: rec.adjustedQty ?? rec.recommendedQty }] });
  await prisma.recommendation.updateMany({ where: { id, shopId, status: { in: ["CONFIRMED", "ORDERED"] } }, data: { status: "ORDERED" } });
  await prisma.auditLog.create({ data: { actorId, action: "recommendation.order", entity: "Recommendation", entityId: id, metadata: { orderId: order.id } } });
  return { order, replayed };
}
