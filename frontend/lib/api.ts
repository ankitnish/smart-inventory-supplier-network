const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { path: string; message: string }[]) { super(message); }
}
type Query = Record<string, string | number | boolean | undefined | null>;
interface Opts { method?: string; body?: unknown; headers?: Record<string, string>; query?: Query }

/** Thin fetch wrapper: sends the httpOnly session cookie, unwraps { success, data }, and turns failures into ApiError. */
export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", credentials: "include", headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw new ApiError(0, "NETWORK", "Cannot reach the server. Check that the backend is running and try again."); }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new ApiError(res.status, json?.error?.code ?? "ERROR", json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  return json.data as T;
}
export const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const toApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", e instanceof Error ? e.message : "Something went wrong"));
