import { prisma } from "./prisma";
import { stockStatus } from "../modules/inventory/stock-math";

/** Run after a stock change commits. Creates at most one unread notification per item per status; never changes stock. */
export async function checkLowStock(shopId: string, inventoryIds: string[]) {
  const rows = await prisma.shopInventory.findMany({ where: { id: { in: inventoryIds }, shopId }, include: { product: true, shop: true } });
  for (const r of rows) {
    const st = stockStatus(r.quantity, r.reserved, r.minLevel, r.reorderPoint);
    if (st !== "LOW" && st !== "OUT_OF_STOCK") continue;
    const type = st === "OUT_OF_STOCK" ? "inventory.out-of-stock" : "inventory.low-stock";
    const dup = await prisma.notification.findFirst({ where: { userId: r.shop.ownerId, type, readAt: null, data: { path: ["inventoryId"], equals: r.id } } });
    if (dup) continue;
    await prisma.notification.create({ data: { userId: r.shop.ownerId, type,
      title: st === "OUT_OF_STOCK" ? `Out of stock: ${r.product.name}` : `Low stock: ${r.product.name}`,
      body: `${r.quantity} units left (minimum ${r.minLevel}).`, data: { inventoryId: r.id } } });
  }
}
