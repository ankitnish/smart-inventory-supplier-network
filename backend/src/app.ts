import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { errorHandler } from "./utils/http";
import auth from "./modules/auth/auth.routes";
import products from "./modules/products/products.routes";
import inventory from "./modules/inventory/inventory.routes";
import sales from "./modules/inventory/sales.routes";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(","), credentials: true })); // explicit allow-list, never "*"
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", auth);
  app.use("/api/products", products);
  app.use("/api/inventory", inventory);
  app.use("/api/sales", sales);
  // Next modules (Phase 2+): products, inventory, sales, purchase-orders, deliveries, analytics, recommendations, notifications, admin
  app.use((_req, res) => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.use(errorHandler);
  return app;
}
