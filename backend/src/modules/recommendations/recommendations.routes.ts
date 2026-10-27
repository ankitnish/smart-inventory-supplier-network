import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../../utils/http";
import { requireActive, requireAuth, requireRole, shopIdOf } from "../../middleware/auth";
import { adjustRecommendation, confirmRecommendation, dismissRecommendation, generateRecommendations, listRecommendations, orderFromRecommendation } from "./recommendations.service";

const r = Router();
r.use(requireAuth, requireRole("SHOP_OWNER"), requireActive);

r.post("/generate", asyncHandler(async (req, res) => {
  const b = z.object({ productIds: z.array(z.string()).max(100).optional(), reviewPeriodDays: z.number().min(1).max(60).optional(),
    defaultLeadTimeDays: z.number().min(0).max(60).optional(), serviceLevelZ: z.number().min(0).max(3.5).optional(), historyDays: z.number().int().min(14).max(365).optional() }).parse(req.body ?? {});
  ok(res, await generateRecommendations(shopIdOf(req), b), 201);
}));

r.get("/", asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(["PENDING", "ADJUSTED", "CONFIRMED", "DISMISSED", "ORDERED"]).optional() }).parse(req.query);
  ok(res, await listRecommendations(shopIdOf(req), status));
}));

r.patch("/:id", asyncHandler(async (req, res) => {
  const { adjustedQty } = z.object({ adjustedQty: z.number().int().min(1).max(1_000_000) }).parse(req.body);
  ok(res, await adjustRecommendation(shopIdOf(req), req.params.id, adjustedQty));
}));
r.post("/:id/confirm", asyncHandler(async (req, res) => ok(res, await confirmRecommendation(shopIdOf(req), req.params.id))));
r.post("/:id/dismiss", asyncHandler(async (req, res) => ok(res, await dismissRecommendation(shopIdOf(req), req.params.id))));
// Creates a DRAFT order only; the owner still reviews and submits it.
r.post("/:id/create-order", asyncHandler(async (req, res) => {
  const out = await orderFromRecommendation(shopIdOf(req), req.user!.id, req.params.id);
  ok(res, { ...out.order, replayed: out.replayed }, out.replayed ? 200 : 201);
}));

export default r;
