import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireAuth } from "../../middleware/auth";

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const password = z.string().min(10, "At least 10 characters").max(128).regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a digit");

// Only SHOP_OWNER and SUPPLIER are accepted: ADMIN cannot be self-registered (enum excludes it).
const registerSchema = z.discriminatedUnion("accountType", [
  z.object({ accountType: z.literal("SHOP_OWNER"), email: z.string().email().toLowerCase(), password, name: z.string().trim().min(2).max(80),
    businessName: z.string().trim().min(2).max(120), address: z.string().trim().max(200).optional() }),
  z.object({ accountType: z.literal("SUPPLIER"), email: z.string().email().toLowerCase(), password, name: z.string().trim().min(2).max(80),
    businessName: z.string().trim().min(2).max(120), address: z.string().trim().max(200).optional() }),
]);

const sign = (id: string) => jwt.sign({ sub: id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: env.NODE_ENV === "production", maxAge: 8 * 3600_000 };
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);

r.post("/register", limiter, asyncHandler(async (req, res) => {
  const b = registerSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: b.email } })) throw new HttpError(409, "An account with this email already exists", "EMAIL_TAKEN");
  const user = await prisma.user.create({ data: {
    email: b.email, name: b.name, role: b.accountType, passwordHash: await bcrypt.hash(b.password, 12),
    status: "PENDING", // admin verification required before full access
    ...(b.accountType === "SHOP_OWNER" ? { shop: { create: { name: b.businessName, address: b.address } } }
                                       : { supplier: { create: { name: b.businessName, address: b.address } } }) } });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "auth.register", entity: "User", entityId: user.id, ip: req.ip } });
  ok(res, { id: user.id, status: user.status, message: "Registered. Your account awaits admin verification." }, 201);
}));

r.post("/login", limiter, asyncHandler(async (req, res) => {
  const { email, password: pw } = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(pw, user?.passwordHash ?? DUMMY_HASH); // constant-ish time whether or not user exists
  if (user?.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(429, "Too many failed attempts. Try again later.", "LOCKED");
  if (!user || !valid) {
    if (user) await prisma.user.update({ where: { id: user.id }, data: {
      failedLogins: { increment: 1 }, ...(user.failedLogins + 1 >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60_000), failedLogins: 0 } : {}) } });
    throw new HttpError(401, "Invalid email or password", "BAD_CREDENTIALS");
  }
  if (user.status === "SUSPENDED" || user.status === "REJECTED") throw new HttpError(403, "Account is not active", "ACCOUNT_INACTIVE");
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  const token = sign(user.id);
  res.cookie("sid", token, cookieOpts);
  ok(res, { token, user: { id: user.id, name: user.name, role: user.role, status: user.status } });
}));

r.post("/logout", (_req, res) => { res.clearCookie("sid"); ok(res, { loggedOut: true }); });
r.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, role: true, status: true } });
  ok(res, u);
}));

// Always responds identically so it cannot be used to enumerate accounts. Token delivery (email) is an integration point.
r.post("/forgot-password", limiter, asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email().toLowerCase() }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({ where: { id: user.id }, data: {
      resetTokenHash: crypto.createHash("sha256").update(token).digest("hex"), resetTokenExp: new Date(Date.now() + 30 * 60_000) } });
    if (env.NODE_ENV !== "production") console.log(`[dev only] password reset token for ${email}: ${token}`); // TODO: replace with real mailer
  }
  ok(res, { message: "If that email exists, a reset link has been sent." });
}));

r.post("/reset-password", limiter, asyncHandler(async (req, res) => {
  const { token, password: pw } = z.object({ token: z.string().length(64), password }).parse(req.body);
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await prisma.user.findFirst({ where: { resetTokenHash: hash, resetTokenExp: { gt: new Date() } } });
  if (!user) throw new HttpError(400, "Reset link is invalid or expired", "BAD_TOKEN");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(pw, 12), resetTokenHash: null, resetTokenExp: null, failedLogins: 0, lockedUntil: null } });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "auth.reset-password", entity: "User", entityId: user.id, ip: req.ip } });
  ok(res, { message: "Password updated." });
}));

export default r;
