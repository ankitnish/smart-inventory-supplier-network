import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole, shopIdOf } from "../../middleware/auth";
import { cancelOrder, createOrder, receiveGoods, submitOrder, withProducts } from "./po.workflow";

const r = Router();
r.use(requireAuth, requireRole("SHOP_OWNER"), requireActive);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const createSchema = z.object({
  supplierId: z.string().min(1), submit: z.boolean().default(false),
  items: z.array(z.object({ supplierProductId: z.string().min(1), quantity: z.number().int().min(1).max(100_000) })).min(1).max(50),
});

r.post("/", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req), actorId = req.user!.id;
  const key = String(req.header("Idempotency-Key") ?? "");
  if (key.length < 8 || key.length > 100) throw new HttpError(400, "Idempotency-Key header (8-100 chars) is required", "IDEMPOTENCY_KEY");
  const b = createSchema.parse(req.body);
  let { order, replayed } = await createOrder(shopId, actorId, { supplierId: b.supplierId, idempotencyKey: key, items: b.items });
  if (b.submit && !replayed) order = { ...(await submitOrder(shopId, actorId, order.id)), items: order.items };
  ok(res, { ...order, replayed }, replayed ? 200 : 201);
}));

r.get("/", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req);
  const q = z.object({ status: z.enum(["DRAFT", "SUBMITTED", "ACCEPTED", "REJECTED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
  const where = { shopId, ...(q.status ? { status: q.status } : {}) };
  const [total, items] = await Promise.all([prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { supplier: { select: { id: true, name: true } } } })]);
  ok(res, { total, page: q.page, pageSize: q.pageSize, items });
}));

r.get("/:id", asyncHandler(async (req, res) => {
  const o = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, shopId: shopIdOf(req) },
    include: { items: true, supplier: { select: { id: true, name: true } }, deliveries: true, history: { orderBy: { at: "asc" } } } });
  if (!o) throw new HttpError(404, "Order not found", "NOT_FOUND");
  ok(res, await withProducts(o));
}));

r.post("/:id/submit", asyncHandler(async (req, res) => ok(res, await submitOrder(shopIdOf(req), req.user!.id, req.params.id))));
r.post("/:id/cancel", asyncHandler(async (req, res) => ok(res, await cancelOrder(shopIdOf(req), req.user!.id, req.params.id))));

// Confirm receipt: replenishes stock exactly once. Perishable lines use the supplier's expiry date unless corrected here.
r.post("/:id/receive", asyncHandler(async (req, res) => {
  const b = z.object({ expiry: z.record(z.string(), isoDate).optional() }).parse(req.body ?? {});
  const out = await receiveGoods(shopIdOf(req), req.user!.id, req.params.id, b.expiry ?? {});
  ok(res, { alreadyReceived: out.alreadyReceived, order: out.order });
}));

export default r;
