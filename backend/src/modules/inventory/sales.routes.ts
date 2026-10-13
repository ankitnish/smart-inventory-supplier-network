import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole, shopIdOf } from "../../middleware/auth";
import { recordSale } from "./sales.service";
import { checkLowStock } from "../../services/low-stock";

const r = Router();
r.use(requireAuth, requireRole("SHOP_OWNER"), requireActive);

const saleSchema = z.object({
  items: z.array(z.object({
    inventoryId: z.string().min(1),
    quantity: z.number().int().min(1).max(10_000),
    unitPrice: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(), // defaults to the item's selling price
  })).min(1).max(50),
}).refine((b) => new Set(b.items.map((i) => i.inventoryId)).size === b.items.length, "Each product may appear once per sale");

// Requires an `Idempotency-Key` header so a retried request can never record the sale twice.
r.post("/", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req);
  const key = String(req.header("Idempotency-Key") ?? "");
  if (key.length < 8 || key.length > 100) throw new HttpError(400, "Idempotency-Key header (8-100 chars) is required", "IDEMPOTENCY_KEY");
  const b = saleSchema.parse(req.body);
  const inv = await prisma.shopInventory.findMany({ where: { id: { in: b.items.map((i) => i.inventoryId) }, shopId, isArchived: false } });
  if (inv.length !== b.items.length) throw new HttpError(404, "Inventory item not found for this shop", "NOT_FOUND");
  const price = new Map(inv.map((i) => [i.id, i.sellingPrice.toString()]));
  const { sale, replayed } = await recordSale(shopId, req.user!.id, { idempotencyKey: key,
    items: b.items.map((i) => ({ inventoryId: i.inventoryId, quantity: i.quantity, unitPrice: i.unitPrice ?? (price.get(i.inventoryId) as string) })) });
  if (!replayed) await checkLowStock(shopId, b.items.map((i) => i.inventoryId));
  ok(res, { ...sale, replayed }, replayed ? 200 : 201);
}));

r.get("/", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req);
  const q = z.object({
    from: z.coerce.date().optional(), to: z.coerce.date().optional(), productId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }).parse(req.query);
  const where = { shopId, ...(q.from || q.to ? { soldAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.productId ? { items: { some: { inventory: { productId: q.productId } } } } : {}) };
  const [total, items] = await Promise.all([prisma.sale.count({ where }),
    prisma.sale.findMany({ where, orderBy: { soldAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { items: { include: { inventory: { include: { product: true } } } } } })]);
  ok(res, { total, page: q.page, pageSize: q.pageSize, items });
}));

r.get("/:id", asyncHandler(async (req, res) => {
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, shopId: shopIdOf(req) }, include: { items: { include: { inventory: { include: { product: true } } } } } });
  if (!sale) throw new HttpError(404, "Sale not found", "NOT_FOUND");
  ok(res, sale);
}));

export default r;
