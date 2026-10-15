import { prisma } from "../../src/services/prisma";

export const uid = () => Math.random().toString(36).slice(2, 10);
export const day = (n: number) => new Date(Date.now() + n * 86_400_000);
export const iso = (n: number) => day(n).toISOString().slice(0, 10);

let categoryId: string | undefined;
export async function category() {
  if (!categoryId) categoryId = (await prisma.category.create({ data: { name: `cat-${uid()}` } })).id;
  return categoryId;
}

export async function makeShop() {
  const user = await prisma.user.create({ data: { email: `s-${uid()}@t.test`, passwordHash: "x", name: "Shop", role: "SHOP_OWNER", status: "ACTIVE",
    shop: { create: { name: "Test shop" } } }, include: { shop: true } });
  return { user, shop: user.shop! };
}
export async function makeSupplier() {
  const user = await prisma.user.create({ data: { email: `p-${uid()}@t.test`, passwordHash: "x", name: "Supplier", role: "SUPPLIER", status: "ACTIVE",
    supplier: { create: { name: "Test supplier" } } }, include: { supplier: true } });
  return { user, supplier: user.supplier! };
}
export async function makeProduct(perishable = false) {
  return prisma.product.create({ data: { sku: `T-${uid()}`, name: "Test item", categoryId: await category(), perishable } });
}
export async function makeInventory(shopId: string, productId: string, quantity = 0) {
  return prisma.shopInventory.create({ data: { shopId, productId, quantity, costPrice: "5.00", sellingPrice: "10.00" } });
}
export async function makeOffer(supplierId: string, productId: string, over: { quantity?: number; unitPrice?: string; minOrderQty?: number; isActive?: boolean } = {}) {
  return prisma.supplierProduct.create({ data: { supplierId, productId, unitPrice: over.unitPrice ?? "4.00", quantity: over.quantity ?? 100,
    minOrderQty: over.minOrderQty ?? 1, isActive: over.isActive ?? true } });
}
export const offerQty = async (id: string) => (await prisma.supplierProduct.findUniqueOrThrow({ where: { id } })).quantity;
export const invQty = async (id: string) => (await prisma.shopInventory.findUniqueOrThrow({ where: { id } })).quantity;
export const statusOf = async (id: string) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;
