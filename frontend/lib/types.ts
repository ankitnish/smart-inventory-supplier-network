export type Role = "SHOP_OWNER" | "SUPPLIER" | "ADMIN";
export interface User { id: string; name: string; email?: string; role: Role; status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED" }
export interface Paged<T> { total: number; page: number; pageSize: number; items: T[] }
export type StockStatus = "OK" | "REORDER" | "LOW" | "OUT_OF_STOCK";
export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export interface Category { id: string; name: string }
export interface ProductRow { inventoryId: string; productId: string; sku: string; barcode: string | null; name: string; category: string; unit: string; perishable: boolean; costPrice: string; sellingPrice: string; quantity: number; status: StockStatus; updatedAt: string }
export interface InventoryRow { inventoryId: string; sku: string; name: string; perishable: boolean; quantity: number; reserved: number; available: number; minLevel: number; reorderPoint: number; status: StockStatus; sellableQuantity?: number; expiredQuantity?: number; updatedAt: string }
export interface Movement { id: string; type: string; delta: number; balanceAfter: number; reason: string; createdAt: string }
export interface SaleRow { id: string; total: string; soldAt: string; items: { id: string; quantity: number; unitPrice: string; lineTotal: string; inventory: { product: { name: string; sku: string } } }[] }
export interface NotificationRow { id: string; title: string; body: string; type: string; readAt: string | null; createdAt: string }
export interface Summary {
  activeProducts: number; totalUnits: number; inventoryValuation: string; todaySales: { total: string; count: number };
  stock: { low: number; outOfStock: number; needsReorder: number }; pendingOrders: number; pendingRecommendations: number;
  salesTrend: { date: string; total: string }[]; topSelling: { name: string; sku: string; unitsSold: number }[];
  slowMoving: { name: string; sku: string; onHand: number; unitsSold30d: number }[]; recentSales: { id: string; total: string; soldAt: string; lines: number }[];
  notifications: { unread: number; items: NotificationRow[] };
}
export interface Recommendation {
  id: string; productId: string; recommendedQty: number; adjustedQty: number | null; risk: Risk; explanation: string; status: "PENDING" | "ADJUSTED" | "CONFIRMED" | "DISMISSED" | "ORDERED";
  generatedAt: string; product: { id: string; name: string; sku: string } | null; supplier: { id: string; name: string } | null;
  assumptions: {
    generatedAt: string; methodVersion: string; suggestedOrderDate: string;
    inputs: { onHand: number; effectiveAvailable: number; incomingQuantity: number; dailyDemand: number; dailyDemandStd: number; leadTimeDays: number; reviewPeriodDays: number; historyDaysUsed: number; serviceLevelZ: number };
    forecast: { method: string; horizonDays: number; totalDemand: number; validation: { method: string; mae: number | null; rmse: number | null }[]; fallbackReason: string | null };
    stockout: { daysRemaining: number | null; beforeReplenishment: boolean; risk: string; explanation: string };
    reorder: { quantity: number; safetyStock: number; demandOverHorizon: number; suggestedOrderInDays: number };
    supplier: { name: string; unitPrice: string; leadTimeDays: number; minOrderQty: number; availableQuantity: number; rank?: number; score?: number } | null;
    perishable?: { sellableQuantity: number; expiredQuantity: number; projectedWaste: number };
  };
}
export interface OrderRow { id: string; number: string; status: "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED"; total: string; createdAt: string; rejectionReason: string | null; receivedAt: string | null; supplier: { id: string; name: string } }
export interface OrderDetail extends OrderRow {
  items: { id: string; quantity: number; unitPrice: string; lineTotal: string; expiryDate: string | null; lotCode: string | null; product: { sku: string; name: string; perishable: boolean } | null }[];
  deliveries: { id: string; reference: string; status: string; estimatedAt: string | null; tracking: string | null }[]; history: { id: string; from: string | null; to: string; note: string | null; at: string }[];
}
