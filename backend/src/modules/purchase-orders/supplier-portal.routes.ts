import { Router, Request } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole } from "../../middleware/auth";
import { acceptOrder, deliverOrder, processOrder, rejectOrder, shipOrder, withProducts } from "./po.workflow";

const r = Router();
r.use(requireAuth, requireRole("SUPPLIER"), requireActive);
const supplierOf = (req: Request) => { if (!req.user?.supplierId) throw new HttpError(403, "No supplier profile linked", "FORBIDDEN"); return req.user.supplierId; };
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Use a number with up to 2 decimals").refine((v) => Number(v) > 0, "Must be greater than 0");
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };

r.get("/dashboard", asyncHandler(async (req, res) => {
  const supplierId = supplierOf(req);
  const { lowStockThreshold } = z.object({ lowStockThreshold: z.coerce.number().int().min(0).default(20) }).parse(req.query);
  const [byStatus, listed, active, low, recent] = await Promise.all([
    prisma.purchaseOrder.groupBy({ by: ["status"], where: { supplierId, status: { not: "DRAFT" } }, _count: { _all: true }, _sum: { total: true } }),
    prisma.supplierProduct.count({ where: { supplierId } }), prisma.supplierProduct.count({ where: { supplierId, isActive: true } }),
    prisma.supplierProduct.findMany({ where: { supplierId, isActive: true, quantity: { lte: lowStockThreshold } }, include: { product: { select: { name: true, sku: true } } }, take: 10 }),
    prisma.auditLog.findMany({ where: { entity: "PurchaseOrder", entityId: { in: (await prisma.purchaseOrder.findMany({ where: { supplierId }, select: { id: true }, take: 50 })).map((o) => o.id) } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const n = (...s: string[]) => byStatus.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
  ok(res, { listedProducts: listed, activeListings: active, incomingOrders: n("SUBMITTED", "ACCEPTED", "PROCESSING", "SHIPPED"),
    awaitingAcceptance: n("SUBMITTED"), processing: n("ACCEPTED", "PROCESSING"), shipped: n("SHIPPED"), completed: n("DELIVERED"),
    deliveredValue: byStatus.find((x) => x.status === "DELIVERED")?._sum.total ?? "0", lowStock: low, recentActivity: recent });
}));

// ---- catalog and listings
r.get("/catalog", asyncHandler(async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(80).optional() }).parse(req.query);
  ok(res, await prisma.product.findMany({ where: { isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}) },
    select: { id: true, sku: true, name: true, perishable: true, category: { select: { name: true } } }, take: 25, orderBy: { name: "asc" } }));
}));

r.get("/products", asyncHandler(async (req, res) => {
  const supplierId = supplierOf(req);
  const q = z.object({ q: z.string().trim().max(80).optional(), active: z.enum(["true", "false"]).optional(), ...page }).parse(req.query);
  const where: Prisma.SupplierProductWhereInput = { supplierId, ...(q.active ? { isActive: q.active === "true" } : {}),
    ...(q.q ? { product: { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { sku: { contains: q.q, mode: "insensitive" } }] } } : {}) };
  const [total, items] = await Promise.all([prisma.supplierProduct.count({ where }),
    prisma.supplierProduct.findMany({ where, orderBy: { product: { name: "asc" } }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { product: { select: { sku: true, name: true } } } })]);
  ok(res, { total, page: q.page, pageSize: q.pageSize, items });
}));

r.post("/products", asyncHandler(async (req, res) => {
  const supplierId = supplierOf(req);
  const b = z.object({ productId: z.string().min(1), unitPrice: money, quantity: z.number().int().min(0).max(10_000_000).default(0),
    leadTimeDays: z.number().int().min(0).max(365).default(3), minOrderQty: z.number().int().min(1).default(1) }).parse(req.body);
  if (!(await prisma.product.findFirst({ where: { id: b.productId, isActive: true } }))) throw new HttpError(404, "Catalog product not found", "NOT_FOUND");
  try {
    const o = await prisma.supplierProduct.create({ data: { supplierId, ...b } });
    if (b.quantity > 0) await prisma.supplierStockMovement.create({ data: { supplierProductId: o.id, delta: b.quantity, balanceAfter: b.quantity, reason: "Opening stock", actorId: req.user!.id } });
    ok(res, o, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "You already list this product", "DUPLICATE");
    throw e;
  }
}));

r.patch("/products/:id", asyncHandler(async (req, res) => {
  const supplierId = supplierOf(req);
  const b = z.object({ unitPrice: money.optional(), leadTimeDays: z.number().int().min(0).max(365).optional(), minOrderQty: z.number().int().min(1).optional(), isActive: z.boolean().optional() })
    .refine((x) => Object.keys(x).length > 0, "Nothing to update").parse(req.body);
  const done = await prisma.supplierProduct.updateMany({ where: { id: req.params.id, supplierId }, data: b }); // supplierId scope: only your own listings
  if (done.count !== 1) throw new HttpError(404, "Listing not found", "NOT_FOUND");
  ok(res, await prisma.supplierProduct.findUniqueOrThrow({ where: { id: req.params.id } }));
}));

// ---- supplier inventory (separate from any shop inventory)
r.post("/products/:id/stock", asyncHandler(async (req, res) => {
  const supplierId = supplierOf(req), actorId = req.user!.id;
  const b = z.object({ delta: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 1_000_000), reason: z.string().trim().min(3).max(200) }).parse(req.body);
  const after = await prisma.$transaction(async (tx) => {
    const upd = await tx.supplierProduct.updateMany({ where: { id: req.params.id, supplierId, ...(b.delta < 0 ? { quantity: { gte: -b.delta } } : {}) }, data: { quantity: { increment: b.delta } } });
    if (upd.count !== 1) { const row = await tx.supplierProduct.findFirst({ where: { id: req.params.id, supplierId } });
      throw row ? new HttpError(409, `Cannot remove ${-b.delta}: only ${row.quantity} in stock`, "INSUFFICIENT_STOCK") : new HttpError(404, "Listing not found", "NOT_FOUND"); }
    const row = await tx.supplierProduct.findUniqueOrThrow({ where: { id: req.params.id } });
    await tx.supplierStockMovement.create({ data: { supplierProductId: row.id, delta: b.delta, balanceAfter: row.quantity, reason: b.reason, actorId } });
    await tx.auditLog.create({ data: { actorId, action: "supplier-stock.adjust", entity: "SupplierProduct", entityId: row.id, metadata: { delta: b.delta, reason: b.reason } } });
    return row;
  });
  ok(res, { id: after.id, quantity: after.quantity });
}));

r.get("/products/:id/movements", asyncHandler(async (req, res) => {
  const supplierId = supplierOf(req);
  const q = z.object(page).parse(req.query);
  const where = { supplierProductId: req.params.id, offer: { supplierId } };
  const [total, items] = await Promise.all([prisma.supplierStockMovement.count({ where }), prisma.supplierStockMovement.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
  ok(res, { total, page: q.page, pageSize: q.pageSize, items });
}));

// ---- incoming orders (drafts are never visible to suppliers)
r.get("/orders", asyncHandler(async (req, res) => {
  const supplierId = supplierOf(req);
  const q = z.object({ status: z.enum(["SUBMITTED", "ACCEPTED", "REJECTED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]).optional(), ...page }).parse(req.query);
  const where = { supplierId, status: q.status ?? { not: "DRAFT" as const } };
  const [total, items] = await Promise.all([prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { shop: { select: { id: true, name: true } } } })]);
  ok(res, { total, page: q.page, pageSize: q.pageSize, items });
}));

r.get("/orders/:id", asyncHandler(async (req, res) => {
  const o = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, supplierId: supplierOf(req), status: { not: "DRAFT" } },
    include: { items: true, shop: { select: { id: true, name: true, address: true } }, deliveries: true, history: { orderBy: { at: "asc" } } } });
  if (!o) throw new HttpError(404, "Order not found", "NOT_FOUND");
  ok(res, await withProducts(o));
}));

r.post("/orders/:id/accept", asyncHandler(async (req, res) => ok(res, await acceptOrder(supplierOf(req), req.user!.id, req.params.id))));
r.post("/orders/:id/reject", asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, "A rejection reason is required").max(300) }).parse(req.body);
  ok(res, await rejectOrder(supplierOf(req), req.user!.id, req.params.id, reason));
}));
r.post("/orders/:id/process", asyncHandler(async (req, res) => ok(res, await processOrder(supplierOf(req), req.user!.id, req.params.id))));
r.post("/orders/:id/ship", asyncHandler(async (req, res) => {
  const b = z.object({ estimatedAt: z.coerce.date().optional(), tracking: z.string().trim().max(100).optional(),
    items: z.array(z.object({ itemId: z.string(), expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), lotCode: z.string().max(40).optional() })).optional() }).parse(req.body ?? {});
  ok(res, await shipOrder(supplierOf(req), req.user!.id, req.params.id, b));
}));
r.post("/orders/:id/deliver", asyncHandler(async (req, res) => ok(res, await deliverOrder(supplierOf(req), req.user!.id, req.params.id))));

r.get("/deliveries", asyncHandler(async (req, res) => {
  const q = z.object(page).parse(req.query);
  const where = { order: { supplierId: supplierOf(req) } };
  const [total, items] = await Promise.all([prisma.delivery.count({ where }),
    prisma.delivery.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { order: { select: { id: true, number: true, status: true } } } })]);
  ok(res, { total, page: q.page, pageSize: q.pageSize, items });
}));

export default r;
