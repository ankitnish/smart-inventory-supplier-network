import { env } from "../config/env";

/** Calls the ML service with a timeout. Callers must handle failure: recommendations are advisory, never required. */
export async function mlPost<T>(path: string, body: unknown, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.ML_SERVICE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) throw new Error(`ML service responded ${res.status}`);
    return (await res.json()) as T;
  } finally { clearTimeout(timer); }
}
