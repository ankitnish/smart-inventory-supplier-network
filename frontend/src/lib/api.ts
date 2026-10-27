const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const opts: RequestInit = {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(res.status, err.code ?? "UNKNOWN", err.message ?? res.statusText);
  }
  return json?.data ?? json;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>("POST", path, body, headers),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/* ---------- Auth ---------- */
export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  role: "SHOP_OWNER" | "SUPPLIER" | "ADMIN";
  status: string;
}
export interface LoginResponse {
  token: string;
  user: AuthUser;
}
export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }),
  register: (body: {
    accountType: "SHOP_OWNER" | "SUPPLIER";
    email: string;
    password: string;
    name: string;
    businessName: string;
  }) => api.post<{ id: string; status: string; message: string }>("/auth/register", body),
  me: () => api.get<AuthUser>("/auth/me"),
  logout: () => api.post("/auth/logout"),
};

/* ---------- Products ---------- */
export interface ProductItem {
  inventoryId: string;
  productId: string;
  sku: string;
  barcode?: string;
  name: string;
  category: string;
  unit: string;
  perishable: boolean;
  costPrice: string;
  sellingPrice: string;
  quantity: number;
  status: string;
  updatedAt: string;
}
export interface ProductList {
  total: number;
  page: number;
  pageSize: number;
  items: ProductItem[];
}
export const productsApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return api.get<ProductList>(`/products${q}`);
  },
  create: (body: Record<string, unknown>) => api.post("/products", body),
  archive: (inventoryId: string) => api.del(`/products/${inventoryId}`),
};

/* ---------- Inventory ---------- */
export interface InventoryItem {
  inventoryId: string;
  sku: string;
  name: string;
  perishable: boolean;
  quantity: number;
  reserved: number;
  available: number;
  minLevel: number;
  reorderPoint: number;
  status: string;
  sellableQuantity?: number;
  expiredQuantity?: number;
  updatedAt: string;
}
export const inventoryApi = {
  list: () => api.get<InventoryItem[]>("/inventory"),
  adjust: (inventoryId: string, delta: number, reason: string) =>
    api.post(`/inventory/${inventoryId}/adjust`, { delta, reason }),
  movements: (inventoryId: string, page = 1) =>
    api.get<{ total: number; page: number; items: unknown[] }>(
      `/inventory/${inventoryId}/movements?page=${page}`,
    ),
};

/* ---------- Sales ---------- */
export const salesApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return api.get<{ total: number; page: number; items: unknown[] }>(`/sales${q}`);
  },
  record: (
    items: { inventoryId: string; quantity: number }[],
    idempotencyKey: string,
  ) =>
    api.post("/sales", { items }, { "Idempotency-Key": idempotencyKey }),
};

/* ---------- Suppliers ---------- */
export interface SupplierItem {
  id: string;
  name: string;
  address?: string;
  verified: boolean;
  reliability: number | null;
}
export const suppliersApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return api.get<{ total: number; items: SupplierItem[] }>(`/suppliers${q}`);
  },
  get: (id: string) => api.get<SupplierItem & { products: unknown[] }>(`/suppliers/${id}`),
  offers: (productId: string, quantity = 1) =>
    api.get<{ ranking: unknown; offers: unknown[] }>(
      `/suppliers/offers?productId=${productId}&quantity=${quantity}`,
    ),
};

/* ---------- Purchase Orders ---------- */
export interface PurchaseOrder {
  id: string;
  number: string;
  status: string;
  total: string;
  supplier: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
export const purchaseOrdersApi = {
  list: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return api.get<{ total: number; items: PurchaseOrder[] }>(`/purchase-orders${q}`);
  },
  get: (id: string) => api.get<PurchaseOrder & { items: unknown[]; history: unknown[] }>(`/purchase-orders/${id}`),
  create: (body: Record<string, unknown>, idempotencyKey: string) =>
    api.post("/purchase-orders", body, { "Idempotency-Key": idempotencyKey }),
  submit: (id: string) => api.post(`/purchase-orders/${id}/submit`),
  cancel: (id: string) => api.post(`/purchase-orders/${id}/cancel`),
  receive: (id: string, expiry?: Record<string, string>) =>
    api.post(`/purchase-orders/${id}/receive`, expiry ? { expiry } : {}),
};

/* ---------- Recommendations ---------- */
export interface Recommendation {
  id: string;
  productId: string;
  recommendedQty: number;
  adjustedQty?: number;
  suggestedSupplierId?: string;
  risk: string;
  explanation: string;
  assumptions: Record<string, unknown>;
  status: string;
  generatedAt: string;
  product?: { id: string; name: string; sku: string } | null;
  supplier?: { id: string; name: string } | null;
}
export const recommendationsApi = {
  generate: (opts?: Record<string, unknown>) =>
    api.post<{ generated: Recommendation[]; skipped: unknown[] }>("/recommendations/generate", opts),
  list: (status?: string) =>
    api.get<Recommendation[]>(`/recommendations${status ? `?status=${status}` : ""}`),
  adjust: (id: string, adjustedQty: number) => api.patch(`/recommendations/${id}`, { adjustedQty }),
  confirm: (id: string) => api.post(`/recommendations/${id}/confirm`),
  dismiss: (id: string) => api.post(`/recommendations/${id}/dismiss`),
  createOrder: (id: string) => api.post(`/recommendations/${id}/create-order`),
};
