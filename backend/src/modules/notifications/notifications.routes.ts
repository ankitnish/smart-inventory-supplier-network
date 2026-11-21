import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../services/prisma";
import { asyncHandler, HttpError, ok } from "../../utils/http";
import { requireAuth } from "../../middleware/auth";

const r = Router();
r.use(requireAuth); // every role sees only their own notifications

r.get("/", asyncHandler(async (req, res) => {
  const q = z.object({ unread: z.enum(["true", "false"]).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(15) }).parse(req.query);
  const where = { userId: req.user!.id, ...(q.unread === "true" ? { readAt: null } : {}) };
  const [total, unread, items] = await Promise.all([prisma.notification.count({ where }), prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
  ok(res, { total, unread, page: q.page, pageSize: q.pageSize, items });
}));
r.post("/read-all", asyncHandler(async (req, res) => ok(res, { updated: (await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } })).count })));
r.post("/:id/read", asyncHandler(async (req, res) => {
  const done = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { readAt: new Date() } });
  if (done.count !== 1) throw new HttpError(404, "Notification not found", "NOT_FOUND");
  ok(res, { read: true });
}));
export default r;
