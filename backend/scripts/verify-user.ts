/** Development helper until the admin portal exists: npx tsx scripts/verify-user.ts someone@example.com [ACTIVE|SUSPENDED|REJECTED|PENDING] */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const [email, status = "ACTIVE"] = process.argv.slice(2);
  if (!email || !["ACTIVE", "SUSPENDED", "REJECTED", "PENDING"].includes(status)) throw new Error("Usage: verify-user.ts <email> [ACTIVE|SUSPENDED|REJECTED|PENDING]");
  const u = await prisma.user.update({ where: { email: email.toLowerCase() }, data: { status: status as never, emailVerified: status === "ACTIVE" } });
  await prisma.auditLog.create({ data: { action: "user.status-change", entity: "User", entityId: u.id, metadata: { status, via: "cli" } } });
  console.log(`${u.email} (${u.role}) is now ${u.status}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
