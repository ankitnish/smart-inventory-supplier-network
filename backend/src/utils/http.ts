import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { InvalidTransitionError } from "../modules/purchase-orders/state-machine";
import { InsufficientStockError } from "../modules/inventory/stock-math";

export class HttpError extends Error { constructor(public status: number, message: string, public code = "ERROR") { super(message); } }
export const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError)
    return res.status(400).json({ success: false, error: { code: "VALIDATION", message: "Invalid input",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } });
  if (err instanceof HttpError) return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
  if (err instanceof InvalidTransitionError) return res.status(409).json({ success: false, error: { code: "INVALID_TRANSITION", message: err.message } });
  if (err instanceof InsufficientStockError) return res.status(409).json({ success: false, error: { code: "INSUFFICIENT_STOCK", message: err.message } });
  console.error(JSON.stringify({ level: "error", path: req.path, message: (err as Error)?.message })); // never leak internals
  return res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Something went wrong" } });
}
