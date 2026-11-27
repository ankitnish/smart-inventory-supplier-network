import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../../src/services/prisma";
import { createCategory, createProduct, renameCategory, setUserStatus, updateProduct } from "../../src/modules/admin/admin.service";
import { category, makeInventory, makeOffer, makeProduct, makeShop, makeSupplier, uid } from "./fixtures";

beforeAll(() => expect(process.env.DATABASE_URL).toMatch(/_test(\?|$)/)); // never run against the real database

const makeAdmin = () => prisma.user.create({ data: { email: `a-${uid()}@t.test`, passwordHash: "x", name: "Admin", role: "ADMIN", status: "ACTIVE" } });
const pendingShop = () => prisma.user.create({ data: { email: `s-${uid()}@t.test`, passwordHash: "x", name: "New Shop Owner", role: "SHOP_OWNER", status: "PENDING", shop: { create: { name: "Pending shop" } } }, include: { shop: true } });

describe("account verification", () => {
  it("approves an application: status, note, audit entry and notification", async () => {
    const admin = await makeAdmin(); const u = await pendingShop();
    const r = await setUserStatus(admin.id, u.id, "ACTIVE");
    expect(r.status).toBe("ACTIVE");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { shop: true } });
    expect([after.status, after.emailVerified, after.shop!.verificationNote]).toEqual(["ACTIVE", true, "Approved"]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: u.id, action: "user.active" } });
    expect(log.actorId).toBe(admin.id);
    expect(await prisma.notification.count({ where: { userId: u.id, type: "account.status", title: "Account approved" } })).toBe(1);
  });

  it("needs a reason to reject, and stores it for the applicant to see", async () => {
    const admin = await makeAdmin(); const u = await pendingShop();
    await expect(setUserStatus(admin.id, u.id, "REJECTED", "  ")).rejects.toMatchObject({ status: 422 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("PENDING");
    await setUserStatus(admin.id, u.id, "REJECTED", "Address could not be verified");
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: u.shop!.id } })).verificationNote).toBe("Address could not be verified");
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: u.id, type: "account.status" } });
    expect(n.body).toContain("Address could not be verified");
  });

  it("protects admins and prevents self-changes and invalid moves", async () => {
    const admin = await makeAdmin(); const other = await makeAdmin(); const u = await pendingShop();
    await expect(setUserStatus(admin.id, admin.id, "SUSPENDED", "x")).rejects.toMatchObject({ status: 403 });
    await expect(setUserStatus(admin.id, other.id, "SUSPENDED", "x")).rejects.toMatchObject({ status: 403 });
    await expect(setUserStatus(admin.id, u.id, "SUSPENDED", "x")).rejects.toMatchObject({ status: 409 }); // pending cannot be suspended
    await expect(setUserStatus(admin.id, "missing-id", "ACTIVE")).rejects.toMatchObject({ status: 404 });
  });

  it("lets only one of two simultaneous decisions win", async () => {
    const a1 = await makeAdmin(); const a2 = await makeAdmin(); const u = await pendingShop();
    const res = await Promise.allSettled([setUserStatus(a1.id, u.id, "ACTIVE"), setUserStatus(a2.id, u.id, "REJECTED", "Duplicate application")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: u.id, action: { in: ["user.active", "user.rejected"] } } })).toBe(1);
  });

  it("suspends and reactivates a live account", async () => {
    const admin = await makeAdmin(); const { user } = await makeShop();
    await setUserStatus(admin.id, user.id, "SUSPENDED", "Chargeback dispute");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("SUSPENDED");
    await setUserStatus(admin.id, user.id, "ACTIVE");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("ACTIVE");
  });
});

describe("master catalog", () => {
  it("rejects duplicate categories regardless of letter case", async () => {
    const admin = await makeAdmin(); const name = `Cat ${uid()}`;
    const c = await createCategory(admin.id, name);
    await expect(createCategory(admin.id, name.toUpperCase())).rejects.toMatchObject({ status: 409 });
    const other = await createCategory(admin.id, `Cat ${uid()}`);
    await expect(renameCategory(admin.id, other.id, name.toLowerCase())).rejects.toMatchObject({ status: 409 });
    expect((await renameCategory(admin.id, c.id, `${name} renamed`)).name).toBe(`${name} renamed`);
  });

  it("avoids duplicate SKUs and same-named products in a category", async () => {
    const admin = await makeAdmin(); const categoryId = await category(); const sku = `ADM-${uid()}`.toUpperCase();
    await createProduct(admin.id, { sku: sku.toLowerCase(), name: `Unique ${sku}`, categoryId, unit: "unit", perishable: false }); // SKU is normalised to upper case
    await expect(createProduct(admin.id, { sku, name: "Different name", categoryId, unit: "unit", perishable: false })).rejects.toMatchObject({ status: 409 });
    await expect(createProduct(admin.id, { sku: `ADM-${uid()}`, name: `UNIQUE ${sku}`, categoryId, unit: "unit", perishable: false })).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
  });

  it("locks the perishable setting once shops or suppliers use the product", async () => {
    const admin = await makeAdmin(); const { shop } = await makeShop(); const product = await makeProduct(false);
    await updateProduct(admin.id, product.id, { perishable: true }); // unused so far: allowed
    await updateProduct(admin.id, product.id, { perishable: false });
    await makeInventory(shop.id, product.id, 5);
    await expect(updateProduct(admin.id, product.id, { perishable: true })).rejects.toMatchObject({ code: "PERISHABLE_LOCKED" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).perishable).toBe(false);
  });

  it("refuses to deactivate a product with live listings unless forced, then hides them", async () => {
    const admin = await makeAdmin(); const { supplier } = await makeSupplier(); const product = await makeProduct(false);
    const offer = await makeOffer(supplier.id, product.id);
    await expect(updateProduct(admin.id, product.id, { isActive: false })).rejects.toMatchObject({ status: 409, code: "LISTINGS_ACTIVE" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).isActive).toBe(true);
    const r = await updateProduct(admin.id, product.id, { isActive: false, force: true });
    expect(r.hiddenListings).toBe(1);
    expect((await prisma.supplierProduct.findUniqueOrThrow({ where: { id: offer.id } })).isActive).toBe(false);
    expect(await prisma.auditLog.count({ where: { entityId: product.id, action: "catalog.update" } })).toBe(1);
  });
});
