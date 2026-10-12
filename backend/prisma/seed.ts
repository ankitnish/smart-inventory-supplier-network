/* DEMO DATA ONLY. Everything created here is flagged isDemo and is fictional. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

// Deterministic pseudo-random so seed output is reproducible.
let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

async function main() {
  const pw = process.env.DEMO_PASSWORD;
  if (!pw || pw.length < 10) throw new Error("Set DEMO_PASSWORD (>=10 chars) in .env to seed demo accounts");
  const hash = await bcrypt.hash(pw, 12);

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD)
    await prisma.user.upsert({ where: { email: process.env.ADMIN_EMAIL }, update: {},
      create: { email: process.env.ADMIN_EMAIL, name: "Platform Admin", role: "ADMIN", status: "ACTIVE", emailVerified: true,
                passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12) } });

  const cats = await Promise.all(["Grains & Staples", "Beverages", "Household"].map((name) =>
    prisma.category.upsert({ where: { name }, update: {}, create: { name } })));
  const catalog = [
    ["GR-RICE-5", "Rice 5 kg", 0, 240, 310], ["GR-WHEAT-10", "Wheat Flour 10 kg", 0, 380, 450],
    ["GR-DAL-1", "Toor Dal 1 kg", 0, 120, 155], ["BV-TEA-250", "Tea 250 g", 1, 95, 130],
    ["BV-COF-100", "Coffee 100 g", 1, 140, 190], ["HH-SOAP-4", "Laundry Soap 4 pack", 2, 80, 110], ["DY-MILK-1", "Fresh Milk 1 L (perishable)", 1, 42, 56],
  ] as const;
  const products = [];
  for (const [sku, name, c, , ] of catalog)
    products.push(await prisma.product.upsert({ where: { sku }, update: {}, create: { sku, name, categoryId: cats[c].id, unit: "unit", perishable: sku.startsWith("DY-") } }));

  const shopUser = await prisma.user.upsert({ where: { email: "shop.demo@example.test" }, update: {},
    create: { email: "shop.demo@example.test", name: "Demo Shop Owner", role: "SHOP_OWNER", status: "ACTIVE", emailVerified: true, passwordHash: hash,
              shop: { create: { name: "Demo Corner Store (demo)", isDemo: true } } }, include: { shop: true } });
  const shop = shopUser.shop!;

  for (const [i, p] of products.entries()) {
    const [, , , cost, price] = catalog[i];
    const inv = await prisma.shopInventory.upsert({ where: { shopId_productId: { shopId: shop.id, productId: p.id } }, update: {},
      create: { shopId: shop.id, productId: p.id, quantity: 10 + Math.floor(rnd() * 80), minLevel: 10, reorderPoint: 25, costPrice: cost, sellingPrice: price } });
    if (p.perishable && !(await prisma.inventoryBatch.count({ where: { inventoryId: inv.id } }))) {
      const day = (n: number) => new Date(Date.now() + n * 86400_000);
      const bs = [{ q: 12, e: 2, lot: "DEMO-A" }, { q: 40, e: 6, lot: "DEMO-B" }];
      await prisma.inventoryBatch.createMany({ data: bs.map((b) => ({ inventoryId: inv.id, quantity: b.q, receivedQty: b.q, expiryDate: day(b.e), lotCode: b.lot })) });
      await prisma.shopInventory.update({ where: { id: inv.id }, data: { quantity: 52 } }); // keep quantity = sum(batches)
    }
    // 60 days of synthetic sales with a weekend uplift, for forecasting demos.
    if (!(await prisma.sale.count({ where: { shopId: shop.id } }))) {
      for (let d = 60; d >= 1; d--) {
        const day = new Date(Date.now() - d * 86400_000); const wknd = [0, 6].includes(day.getDay());
        const qty = Math.max(0, Math.round((2 + i) * (wknd ? 1.8 : 1) + (rnd() - 0.5) * 3));
        if (!qty) continue;
        await prisma.sale.create({ data: { shopId: shop.id, idempotencyKey: `seed-${p.sku}-${d}`, createdById: shopUser.id, soldAt: day,
          total: qty * price, items: { create: [{ inventoryId: inv.id, quantity: qty, unitPrice: price, lineTotal: qty * price }] } } });
      }
    }
  }

  for (const [n, [name, email, lead, mult]] of ([["Demo Wholesale A (demo)", "supplier.a@example.test", 2, 1.0],
                                                 ["Demo Wholesale B (demo)", "supplier.b@example.test", 4, 0.93]] as const).entries()) {
    const su = await prisma.user.upsert({ where: { email }, update: {},
      create: { email, name: `Demo Supplier ${n ? "B" : "A"}`, role: "SUPPLIER", status: "ACTIVE", emailVerified: true, passwordHash: hash,
                supplier: { create: { name, isDemo: true } } }, include: { supplier: true } });
    for (const [i, p] of products.entries())
      await prisma.supplierProduct.upsert({ where: { supplierId_productId: { supplierId: su.supplier!.id, productId: p.id } }, update: {},
        create: { supplierId: su.supplier!.id, productId: p.id, unitPrice: Math.round(catalog[i][3] * 0.85 * mult * 100) / 100, quantity: 500, leadTimeDays: lead } });
  }
  console.log("Demo seed complete (fictional data).");
}
main().finally(() => prisma.$disconnect());
