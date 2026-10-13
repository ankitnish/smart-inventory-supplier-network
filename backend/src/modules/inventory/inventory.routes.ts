import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole, shopIdOf } from "../../middleware/auth";
import { stockStatus } from "./stock-math";
import { expiredQuantity, sellableQuantity } from "./expiry";
import { checkLowStock } from "../../services/low-stock";

const r = Router();
r.use(requireAuth, requireRole("SHOP_OWNER"), requireActive);

r.get("/", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req);
  const rows = await prisma.shopInventory.findMany({ where: { shopId, isArchived: false }, orderBy: { product: { name: "asc" } },
    include: { product: true, batches: { where: { quantity: { gt: 0 } } } } });
  const today = new Date();
  ok(res, rows.map((i) => ({
    inventoryId: i.id, sku: i.product.sku, name: i.product.name, perishable: i.product.perishable,
    quantity: i.quantity, reserved: i.reserved, available: Math.max(0, i.quantity - i.reserved),
    minLevel: i.minLevel, reorderPoint: i.reorderPoint, status: stockStatus(i.quantity, i.reserved, i.minLevel, i.reorderPoint),
    ...(i.product.perishable ? { sellableQuantity: sellableQuantity(i.batches, today), expiredQuantity: expiredQuantity(i.batches, today) } : {}),
    updatedAt: i.updatedAt })));
}));

const adjustSchema = z.object({
  delta: z.number().int().refine((n) => n !== 0, "Delta cannot be zero").refine((n) => Math.abs(n) <= 100_000, "Delta too large"),
  reason: z.string().trim().min(3, "A reason is required").max(200),
});

r.post("/:inventoryId/adjust", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req), actorId = req.user!.id, id = req.params.inventoryId;
  const b = adjustSchema.parse(req.body);
  const out = await prisma.$transaction(async (tx) => {
    const row = await tx.shopInventory.findFirst({ where: { id, shopId, isArchived: false }, include: { product: true } });
    if (!row) throw new HttpError(404, "Inventory item not found", "NOT_FOUND");
    if (row.product.perishable) throw new HttpError(409, "Perishable stock changes through purchase receipts, sales and expiry write-offs", "PERISHABLE");
    const upd = await tx.shopInventory.updateMany({ where: { id, shopId, ...(b.delta < 0 ? { quantity: { gte: -b.delta } } : {}) },
      data: { quantity: { increment: b.delta } } }); // conditional: stock can never go negative
    if (upd.count !== 1) throw new HttpError(409, `Cannot remove ${-b.delta}: only ${row.quantity} in stock`, "INSUFFICIENT_STOCK");
    const after = await tx.shopInventory.findUniqueOrThrow({ where: { id } });
    await tx.stockMovement.create({ data: { inventoryId: id, type: "ADJUSTMENT", delta: b.delta, balanceAfter: after.quantity, reason: b.reason, actorId } });
    await tx.auditLog.create({ data: { actorId, action: "inventory.adjust", entity: "ShopInventory", entityId: id, metadata: { delta: b.delta, reason: b.reason }, ip: req.ip } });
    return after;
  });
  await checkLowStock(shopId, [id]);
  ok(res, { inventoryId: id, quantity: out.quantity });
}));

r.get("/:inventoryId/movements", asyncHandler(async (req, res) => {
  const shopId = shopIdOf(req);
  const { page, pageSize } = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const where = { inventoryId: req.params.inventoryId, inventory: { shopId } }; // shop scope blocks other shops' history
  const [total, items] = await Promise.all([prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })]);
  ok(res, { total, page, pageSize, items });
}));

export default r;
