import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../services/prisma";
import { HttpError } from "../utils/http";

export interface AuthUser { id: string; role: Role; status: string; shopId?: string; supplierId?: string }
declare global { namespace Express { interface Request { user?: AuthUser } } }

/** The token proves identity only. Role/status are re-read from the DB on every request,
 *  so suspension and role changes take effect immediately and the client can never assert a role. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.sid ?? req.headers.authorization?.replace(/^Bearer /, "");
    if (!token) throw new HttpError(401, "Authentication required", "UNAUTHENTICATED");
    let sub: string;
    try { sub = (jwt.verify(token, env.JWT_SECRET) as { sub: string }).sub; }
    catch { throw new HttpError(401, "Session expired or invalid", "UNAUTHENTICATED"); }
    const u = await prisma.user.findUnique({ where: { id: sub }, include: { shop: true, supplier: true } });
    if (!u) throw new HttpError(401, "Account not found", "UNAUTHENTICATED");
    if (u.status === "SUSPENDED" || u.status === "REJECTED") throw new HttpError(403, "Account is not active", "ACCOUNT_INACTIVE");
    req.user = { id: u.id, role: u.role, status: u.status, shopId: u.shop?.id, supplierId: u.supplier?.id };
    next();
  } catch (e) { next(e); }
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) =>
  !req.user || !roles.includes(req.user.role) ? next(new HttpError(403, "You do not have access to this resource", "FORBIDDEN")) : next();

/** Business operations need a verified (ACTIVE) account; PENDING accounts can log in but not trade. */
export const requireActive = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.status !== "ACTIVE" ? next(new HttpError(403, "Your account is awaiting admin verification", "ACCOUNT_PENDING")) : next();

export const shopIdOf = (req: Request) => {
  if (!req.user?.shopId) throw new HttpError(403, "No shop is linked to this account", "FORBIDDEN");
  return req.user.shopId;
};
