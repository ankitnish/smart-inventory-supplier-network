import { Router } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole } from "../../middleware/auth";
import { createCategory, createProduct, mlStatus, renameCategory, setUserStatus, updateProduct } from "./admin.service";

const r = Router();
r.use(requireAuth, requireRole("ADMIN"), requireActive); // role is read from the database on every request
const DAY = 86_400_000, dayKey = (d: Date) => d.toISOString().slice(0, 10);
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const paged = <T>(total: number, p: { page: number; pageSize: number }, items: T[]) => ({ total, page: p.page, pageSize: p.pageSize, items });

r.get("/dashboard", asyncHandler(async (_req, res) => {
  const now = new Date(), since30 = new Date(now.getTime() - 30 * DAY);
  const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), since14 = new Date(startToday.getTime() - 13 * DAY);
  const [shops, suppliers, pendingShops, pendingSuppliers, suspended, stale, offers, catalog, ordersByStatus, sales, recent, trendOrders, trendSales, ml] = await Promise.all([
    prisma.shop.count(), prisma.supplier.count(),
    prisma.user.count({ where: { role: "SHOP_OWNER", status: "PENDING" } }), prisma.user.count({ where: { role: "SUPPLIER", status: "PENDING" } }),
    prisma.user.count({ where: { status: "SUSPENDED" } }), prisma.user.count({ where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - 3 * DAY) } } }),
    prisma.supplierProduct.count({ where: { isActive: true } }), prisma.product.count({ where: { isActive: true } }),
    prisma.purchaseOrder.groupBy({ by: ["status"], where: { createdAt: { gte: since30 }, status: { not: "DRAFT" } }, _count: { _all: true } }),
    prisma.sale.aggregate({ where: { soldAt: { gte: since30 } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { actor: { select: { email: true, role: true } } } }),
    prisma.purchaseOrder.findMany({ where: { createdAt: { gte: since14 }, status: { not: "DRAFT" } }, select: { createdAt: true } }),
    prisma.sale.findMany({ where: { soldAt: { gte: since14 } }, select: { soldAt: true } }),
    mlStatus(),
  ]);
  const trend: Record<string, { orders: number; sales: number }> = {};
  for (let t = since14.getTime(); t <= startToday.getTime(); t += DAY) trend[dayKey(new Date(t))] = { orders: 0, sales: 0 };
  for (const o of trendOrders) { const k = dayKey(o.createdAt); if (trend[k]) trend[k].orders++; }
  for (const s of trendSales) { const k = dayKey(s.soldAt); if (trend[k]) trend[k].sales++; }
  const alerts: { level: "warning" | "critical"; message: string }[] = [];
  if (ml === "down") alerts.push({ level: "critical", message: "The forecasting service is not responding. Recommendations cannot be generated." });
  if (stale > 0) alerts.push({ level: "warning", message: `${stale} application(s) have been waiting more than 3 days for review.` });
  if (suspended > 0) alerts.push({ level: "warning", message: `${suspended} account(s) are currently suspended.` });
  ok(res, { shops, suppliers, pendingVerifications: { shops: pendingShops, suppliers: pendingSuppliers }, listedProducts: { activeOffers: offers, catalogProducts: catalog },
    orders30d: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count._all])), sales30d: { count: sales._count._all, total: (sales._sum.total ?? new Decimal(0)).toString() },
    services: { forecasting: ml }, alerts, usageTrend: Object.entries(trend).map(([date, v]) => ({ date, ...v })),
    recentActivity: recent.map((a) => ({ id: a.id, action: a.action, entity: a.entity, createdAt: a.createdAt, actor: a.actor?.email ?? "system" })) });
}));

// ---- users and verification (verification = the PENDING queue of this list)
const userSelect = { id: true, name: true, email: true, role: true, status: true, createdAt: true, shop: { select: { name: true, address: true, verificationNote: true } }, supplier: { select: { name: true, address: true, verificationNote: true } } } as const;
const presentUser = (u: Prisma.UserGetPayload<{ select: typeof userSelect }>) => { const b = u.shop ?? u.supplier; return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt, business: b ? { name: b.name, address: b.address, note: b.verificationNote } : null }; };

r.get("/users", asyncHandler(async (req, res) => {
  const q = z.object({ q: z.string().trim().max(80).optional(), role: z.enum(["SHOP_OWNER", "SUPPLIER", "ADMIN"]).optional(), status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]).optional(), ...page }).parse(req.query);
  const where: Prisma.UserWhereInput = { ...(q.role ? { role: q.role } : {}), ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }, { shop: { name: { contains: q.q, mode: "insensitive" } } }, { supplier: { name: { contains: q.q, mode: "insensitive" } } }] } : {}) };
  const [total, rows] = await Promise.all([prisma.user.count({ where }), prisma.user.findMany({ where, select: userSelect, orderBy: [{ createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
  ok(res, paged(total, q, rows.map(presentUser))); // passwordHash and reset tokens are never selected
}));

r.get("/users/:id", asyncHandler(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: { ...userSelect, shop: { select: { id: true, name: true, address: true, verificationNote: true } }, supplier: { select: { id: true, name: true, address: true, verificationNote: true } } } });
  if (!u) throw new HttpError(404, "User not found", "NOT_FOUND");
  const [orders, history] = await Promise.all([
    u.shop ? prisma.purchaseOrder.count({ where: { shopId: u.shop.id } }) : u.supplier ? prisma.purchaseOrder.count({ where: { supplierId: u.supplier.id, status: { not: "DRAFT" } } }) : 0,
    prisma.auditLog.findMany({ where: { OR: [{ entityId: u.id }, { actorId: u.id }] }, orderBy: { createdAt: "desc" }, take: 10, include: { actor: { select: { email: true } } } }),
  ]);
  ok(res, { ...presentUser(u as never), orders, history: history.map((h) => ({ id: h.id, action: h.action, createdAt: h.createdAt, actor: h.actor?.email ?? "system", metadata: h.metadata })) });
}));

r.post("/users/:id/status", asyncHandler(async (req, res) => {
  const b = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "REJECTED"]), reason: z.string().trim().max(300).optional() }).parse(req.body);
  ok(res, await setUserStatus(req.user!.id, req.params.id, b.status, b.reason, req.ip));
}));

// ---- categories and master catalog
r.get("/categories", asyncHandler(async (_req, res) => ok(res, (await prisma.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } })).map((c) => ({ id: c.id, name: c.name, products: c._count.products })))));
const catName = z.object({ name: z.string().trim().min(2, "At least 2 characters").max(60) });
r.post("/categories", asyncHandler(async (req, res) => ok(res, await createCategory(req.user!.id, catName.parse(req.body).name), 201)));
r.patch("/categories/:id", asyncHandler(async (req, res) => ok(res, await renameCategory(req.user!.id, req.params.id, catName.parse(req.body).name))));

r.get("/catalog", asyncHandler(async (req, res) => {
  const q = z.object({ q: z.string().trim().max(80).optional(), categoryId: z.string().optional(), ...page }).parse(req.query);
  const where: Prisma.ProductWhereInput = { ...(q.categoryId ? { categoryId: q.categoryId } : {}), ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { sku: { contains: q.q, mode: "insensitive" } }] } : {}) };
  const [total, rows] = await Promise.all([prisma.product.count({ where }), prisma.product.findMany({ where, orderBy: { name: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    include: { category: { select: { id: true, name: true } }, _count: { select: { shopInventory: true, supplierOffers: true } } } })]);
  ok(res, paged(total, q, rows.map((p) => ({ id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, unit: p.unit, perishable: p.perishable, isActive: p.isActive, category: p.category, shops: p._count.shopInventory, listings: p._count.supplierOffers }))));
}));
r.post("/catalog", asyncHandler(async (req, res) => {
  const b = z.object({ sku: z.string().trim().min(2).max(40), name: z.string().trim().min(2).max(120), categoryId: z.string().min(1), unit: z.string().trim().min(1).max(20).default("unit"), barcode: z.string().trim().min(4).max(40).optional(), perishable: z.boolean().default(false) }).parse(req.body);
  ok(res, await createProduct(req.user!.id, b), 201);
}));
r.patch("/catalog/:id", asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(120).optional(), categoryId: z.string().optional(), unit: z.string().trim().min(1).max(20).optional(), isActive: z.boolean().optional(), perishable: z.boolean().optional(), force: z.boolean().optional() })
    .refine((x) => Object.keys(x).some((k) => k !== "force"), "Nothing to update").parse(req.body);
  ok(res, await updateProduct(req.user!.id, req.params.id, b));
}));

// ---- monitoring: all orders and the audit log
r.get("/orders", asyncHandler(async (req, res) => {
  const q = z.object({ status: z.enum(["SUBMITTED", "ACCEPTED", "PROCESSING", "SHIPPED", "DELIVERED", "REJECTED", "CANCELLED"]).optional(), ...page }).parse(req.query);
  const where: Prisma.PurchaseOrderWhereInput = { status: q.status ?? { not: "DRAFT" } };
  const [total, rows] = await Promise.all([prisma.purchaseOrder.count({ where }), prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    include: { shop: { select: { name: true } }, supplier: { select: { name: true } } } })]);
  ok(res, paged(total, q, rows.map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.total.toString(), createdAt: o.createdAt, shop: o.shop.name, supplier: o.supplier.name }))));
}));
r.get("/audit-logs", asyncHandler(async (req, res) => {
  const q = z.object({ action: z.string().trim().max(60).optional(), entity: z.string().trim().max(40).optional(), ...page }).parse(req.query);
  const where: Prisma.AuditLogWhereInput = { ...(q.action ? { action: { contains: q.action, mode: "insensitive" } } : {}), ...(q.entity ? { entity: q.entity } : {}) };
  const [total, rows] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { actor: { select: { email: true } } } })]);
  ok(res, paged(total, q, rows.map((a) => ({ id: a.id, action: a.action, entity: a.entity, entityId: a.entityId, createdAt: a.createdAt, actor: a.actor?.email ?? "system", metadata: a.metadata }))));
}));

export default r;
