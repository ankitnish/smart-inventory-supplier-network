"use client";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { Role, User } from "./types";

interface Ctx { user: User | null; loading: boolean; refresh: () => Promise<void>; login: (email: string, password: string) => Promise<User>; logout: () => Promise<void> }
const AuthCtx = createContext<Ctx | null>(null);
export const homeFor = (role: Role) => (role === "SHOP_OWNER" ? "/shop/dashboard" : role === "SUPPLIER" ? "/supplier/dashboard" : "/admin");

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { try { setUser(await api<User>("/auth/me")); } catch { setUser(null); } finally { setLoading(false); } }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const login = useCallback(async (email: string, password: string) => { const r = await api<{ user: User }>("/auth/login", { method: "POST", body: { email, password } }); setUser(r.user); return r.user; }, []);
  const logout = useCallback(async () => { try { await api("/auth/logout", { method: "POST" }); } finally { setUser(null); } }, []);
  return <AuthCtx.Provider value={{ user, loading, refresh, login, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => { const c = useContext(AuthCtx); if (!c) throw new Error("useAuth outside AuthProvider"); return c; };
