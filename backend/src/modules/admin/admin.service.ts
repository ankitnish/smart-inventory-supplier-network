import { Prisma } from "@prisma/client";
import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/http";
import { env } from "../../config/env";
import { AccountStatus, assertStatusChange } from "./admin-rules";

const NOTE: Record<string, { title: string; body: (r?: string) => string }> = {
  ACTIVE: { title: "Account approved", body: () => "Your account has been approved. All features are now available." },
  REJECTED: { title: "Application rejected", body: (r) => `Your application was not approved. Reason: ${r}` },
  SUSPENDED: { title: "Account suspended", body: (r) => `Your account has been suspended. Reason: ${r}` },
};

/** Approve, reject, suspend or reactivate an account. Compare-and-set on the old status stops two admins deciding at once. */
export async function setUserStatus(adminId: string, userId: string, to: AccountStatus, reason?: string, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, include: { shop: true, supplier: true } });
    if (!target) throw new HttpError(404, "User not found", "NOT_FOUND");
    assertStatusChange({ actorId: adminId, target: { id: target.id, role: target.role, status: target.status }, to, reason });
    const done = await tx.user.updateMany({ where: { id: userId, status: target.status }, data: { status: to, ...(to === "ACTIVE" ? { emailVerified: true } : {}) } });
    if (done.count !== 1) throw new HttpError(409, "This account was just changed by someone else. Reload and check its status.", "CONFLICT");
    const note = reason?.trim() || (to === "ACTIVE" ? "Approved" : null);
    if (target.shop) await tx.shop.update({ where: { id: target.shop.id }, data: { verificationNote: note } });
    if (target.supplier) await tx.supplier.update({ where: { id: target.supplier.id }, data: { verificationNote: note } });
    await tx.auditLog.create({ data: { actorId: adminId, action: `user.${to.toLowerCase()}`, entity: "User", entityId: userId, ip, metadata: { from: target.status, to, reason: reason?.trim() ?? null } } });
    await tx.notification.create({ data: { userId, type: "account.status", title: NOTE[to].title, body: NOTE[to].body(reason?.trim()) } });
    return { id: userId, from: target.status, status: to };
  });
}

const audit = (adminId: string, action: string, entity: string, entityId: string, metadata: Prisma.InputJsonValue) =>
  prisma.auditLog.create({ data: { actorId: adminId, action, entity, entityId, metadata } });
const isDup = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// ------------------------------------------------------------------ categories
export async function createCategory(adminId: string, name: string) {
  const clean = name.trim();
  if (await prisma.category.findFirst({ where: { name: { equals: clean, mode: "insensitive" } } })) throw new HttpError(409, "A category with this name already exists", "DUPLICATE");
  try {
    const c = await prisma.category.create({ data: { name: clean } });
    await audit(adminId, "category.create", "Category", c.id, { name: clean });
    return c;
  } catch (e) { if (isDup(e)) throw new HttpError(409, "A category with this name already exists", "DUPLICATE"); throw e; }
}
export async function renameCategory(adminId: string, id: string, name: string) {
  const clean = name.trim();
  const cur = await prisma.category.findUnique({ where: { id } });
  if (!cur) throw new HttpError(404, "Category not found", "NOT_FOUND");
  if (await prisma.category.findFirst({ where: { id: { not: id }, name: { equals: clean, mode: "insensitive" } } })) throw new HttpError(409, "Another category already has this name", "DUPLICATE");
  const c = await prisma.category.update({ where: { id }, data: { name: clean } });
  await audit(adminId, "category.rename", "Category", id, { from: cur.name, to: clean });
  return c;
}

// -------------------------------------------------------------- master catalog
export interface NewProduct { sku: string; name: string; categoryId: string; unit: string; barcode?: string; perishable: boolean }
export async function createProduct(adminId: string, input: NewProduct) {
  const sku = input.sku.trim().toUpperCase(), name = input.name.trim();
  if (!(await prisma.category.findUnique({ where: { id: input.categoryId } }))) throw new HttpError(422, "Unknown category", "BAD_CATEGORY");
  if (await prisma.product.findFirst({ where: { categoryId: input.categoryId, name: { equals: name, mode: "insensitive" } } }))
    throw new HttpError(409, "A product with this name already exists in that category", "DUPLICATE_NAME");
  try {
    const p = await prisma.product.create({ data: { sku, name, categoryId: input.categoryId, unit: input.unit, barcode: input.barcode, perishable: input.perishable } });
    await audit(adminId, "catalog.create", "Product", p.id, { sku, name });
    return p;
  } catch (e) { if (isDup(e)) throw new HttpError(409, "That SKU or barcode is already in the catalog", "DUPLICATE"); throw e; }
}

export interface ProductPatch { name?: string; categoryId?: string; unit?: string; isActive?: boolean; perishable?: boolean; force?: boolean }
/** Changes that would break shops or suppliers are refused (or need explicit force) rather than silently applied. */
export async function updateProduct(adminId: string, id: string, patch: ProductPatch) {
  const p = await prisma.product.findUnique({ where: { id }, include: { _count: { select: { shopInventory: true, supplierOffers: true } } } });
  if (!p) throw new HttpError(404, "Product not found", "NOT_FOUND");
  if (patch.perishable !== undefined && patch.perishable !== p.perishable && (p._count.shopInventory > 0 || p._count.supplierOffers > 0))
    throw new HttpError(409, `Cannot change the perishable setting: ${p._count.shopInventory} shop(s) stock it and ${p._count.supplierOffers} supplier listing(s) use it.`, "PERISHABLE_LOCKED");
  const name = patch.name?.trim(), categoryId = patch.categoryId ?? p.categoryId;
  if (patch.categoryId && !(await prisma.category.findUnique({ where: { id: patch.categoryId } }))) throw new HttpError(422, "Unknown category", "BAD_CATEGORY");
  if ((name || patch.categoryId) && (await prisma.product.findFirst({ where: { id: { not: id }, categoryId, name: { equals: name ?? p.name, mode: "insensitive" } } })))
    throw new HttpError(409, "A product with this name already exists in that category", "DUPLICATE_NAME");
  return prisma.$transaction(async (tx) => {
    let hidden = 0;
    if (patch.isActive === false && p.isActive) {
      const active = await tx.supplierProduct.count({ where: { productId: id, isActive: true } });
      if (active > 0 && !patch.force) throw new HttpError(409, `${active} active supplier listing(s) offer this product. Deactivating it will hide them.`, "LISTINGS_ACTIVE");
      if (active > 0) hidden = (await tx.supplierProduct.updateMany({ where: { productId: id, isActive: true }, data: { isActive: false } })).count;
    }
    const updated = await tx.product.update({ where: { id }, data: { name, categoryId: patch.categoryId, unit: patch.unit, isActive: patch.isActive, perishable: patch.perishable } });
    await tx.auditLog.create({ data: { actorId: adminId, action: "catalog.update", entity: "Product", entityId: id, metadata: { patch: { ...patch, force: undefined }, hiddenListings: hidden } as Prisma.InputJsonValue } });
    return { product: updated, hiddenListings: hidden };
  });
}

/** Reports whether the forecasting service answers, for the admin dashboard. */
export async function mlStatus(): Promise<"ok" | "down"> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2000);
  try { const r = await fetch(`${env.ML_SERVICE_URL}/health`, { signal: ctrl.signal }); return r.ok ? "ok" : "down"; } catch { return "down"; } finally { clearTimeout(t); }
}
