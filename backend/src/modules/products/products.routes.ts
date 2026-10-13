import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole, shopIdOf } from "../../middleware/auth";
import { stockStatus } from "../inventory/stock-math";
import { daysUntilExpiry } from "../inventory/expiry";

const r = Router();
r.use(requireAuth, requireRole("SHOP_OWNER"), requireActive);

const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Use a number with up to 2 decimals");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date");

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  archived: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  sort: z.enum(["name", "updated", "quantity"]).default("name"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

r.get("/", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req);
  const q = listQuery.parse(req.query);
  const where: Prisma.ShopInventoryWhereInput = { shopId, isArchived: q.archived,
    ...(q.q ? { product: { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { sku: { contains: q.q, mode: "insensitive" } }] } } : {}) };
  const orderBy: Prisma.ShopInventoryOrderByWithRelationInput =
    q.sort === "name" ? { product: { name: "asc" } } : q.sort === "quantity" ? { quantity: "asc" } : { updatedAt: "desc" };
  const [total, rows] = await Promise.all([
    prisma.shopInventory.count({ where }),
    prisma.shopInventory.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { product: { include: { category: true } } } }),
  ]);
  ok(res, { total, page: q.page, pageSize: q.pageSize, items: rows.map((i) => ({
    inventoryId: i.id, productId: i.productId, sku: i.product.sku, barcode: i.product.barcode, name: i.product.name,
    category: i.product.category.name, unit: i.product.unit, perishable: i.product.perishable,
    costPrice: i.costPrice, sellingPrice: i.sellingPrice, quantity: i.quantity,
    status: stockStatus(i.quantity, i.reserved, i.minLevel, i.reorderPoint), updatedAt: i.updatedAt })) });
}));

const createSchema = z.object({
  sku: z.string().trim().min(2).max(40).toUpperCase(),
  barcode: z.string().trim().min(4).max(40).optional(),
  name: z.string().trim().min(2).max(120),
  categoryId: z.string().min(1),
  unit: z.string().trim().min(1).max(20).default("unit"),
  perishable: z.boolean().default(false),
  costPrice: money, sellingPrice: money,
  quantity: z.number().int().min(0).max(1_000_000).default(0),
  minLevel: z.number().int().min(0).default(0),
  reorderPoint: z.number().int().min(0).default(0),
  initialExpiryDate: isoDate.optional(),
}).superRefine((b, c) => {
  if (b.perishable && b.quantity > 0) {
    if (!b.initialExpiryDate) c.addIssue({ code: "custom", path: ["initialExpiryDate"], message: "Expiry date required for opening perishable stock" });
    else if (daysUntilExpiry(new Date(b.initialExpiryDate), new Date()) < 0) c.addIssue({ code: "custom", path: ["initialExpiryDate"], message: "Expiry date is in the past" });
  }
  if (Number(b.sellingPrice) < Number(b.costPrice)) c.addIssue({ code: "custom", path: ["sellingPrice"], message: "Selling price is below cost price" });
});

r.post("/", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req), actorId = req.user!.id;
  const b = createSchema.parse(req.body);
  try {
    const inv = await prisma.$transaction(async (tx) => {
      if (!(await tx.category.findUnique({ where: { id: b.categoryId } }))) throw new HttpError(400, "Unknown category", "BAD_CATEGORY");
      let product = await tx.product.findUnique({ where: { sku: b.sku } });
      if (product) { // shared master catalog: reuse the existing product
        if (product.perishable !== b.perishable) throw new HttpError(409, "This SKU exists with a different perishable setting", "CONFLICT");
      } else {
        if (b.barcode && (await tx.product.findUnique({ where: { barcode: b.barcode } }))) throw new HttpError(409, "Barcode already belongs to another product", "DUPLICATE_BARCODE");
        product = await tx.product.create({ data: { sku: b.sku, barcode: b.barcode, name: b.name, unit: b.unit, categoryId: b.categoryId, perishable: b.perishable } });
      }
      if (await tx.shopInventory.findUnique({ where: { shopId_productId: { shopId, productId: product.id } } }))
        throw new HttpError(409, "This product is already in your inventory", "DUPLICATE");
      const inv = await tx.shopInventory.create({ data: { shopId, productId: product.id, quantity: b.quantity, minLevel: b.minLevel,
        reorderPoint: b.reorderPoint, costPrice: b.costPrice, sellingPrice: b.sellingPrice } });
      if (b.quantity > 0) {
        if (b.perishable) await tx.inventoryBatch.create({ data: { inventoryId: inv.id, quantity: b.quantity, receivedQty: b.quantity, expiryDate: new Date(b.initialExpiryDate!), lotCode: "OPENING" } });
        await tx.stockMovement.create({ data: { inventoryId: inv.id, type: "INITIAL", delta: b.quantity, balanceAfter: b.quantity,
          reason: "Opening stock", refType: "ShopInventory", refId: inv.id, actorId } });
      }
      await tx.auditLog.create({ data: { actorId, action: "product.create", entity: "ShopInventory", entityId: inv.id, ip: req.ip } });
      return inv;
    });
    ok(res, { inventoryId: inv.id, productId: inv.productId }, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "SKU or barcode already exists", "DUPLICATE");
    throw e;
  }
}));

// Archive (soft delete): history and movements are kept.
r.delete("/:inventoryId", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req);
  const done = await prisma.shopInventory.updateMany({ where: { id: req.params.inventoryId, shopId, isArchived: false }, data: { isArchived: true } });
  if (done.count !== 1) throw new HttpError(404, "Product not found", "NOT_FOUND");
  await prisma.auditLog.create({ data: { actorId: req.user!.id, action: "product.archive", entity: "ShopInventory", entityId: req.params.inventoryId, ip: req.ip } });
  ok(res, { archived: true });
}));

export default r;
