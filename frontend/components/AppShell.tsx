"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { Bell, Boxes, ClipboardList, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, ShoppingCart, Sparkles, Truck, X } from "lucide-react";
import { homeFor, useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { NotificationRow, Role } from "@/lib/types";
import { Alert, Button, cx, Skeleton } from "./ui";
import { dateTime } from "@/lib/format";

const NAV = [
  { href: "/shop/dashboard", label: "Dashboard", icon: LayoutDashboard }, { href: "/shop/products", label: "Products", icon: Boxes },
  { href: "/shop/inventory", label: "Inventory", icon: ClipboardList }, { href: "/shop/sales", label: "Sales", icon: ShoppingCart },
  { href: "/shop/recommendations", label: "Recommendations", icon: Sparkles }, { href: "/shop/purchase-orders", label: "Purchase orders", icon: Truck },
];

/** Redirects anonymous users to /login and users of another role to their own home. The server still enforces every permission. */
export function AuthGate({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth(); const router = useRouter(); const path = usePathname();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (user.role !== role) router.replace(homeFor(user.role));
  }, [user, loading, role, router, path]);
  if (loading || !user || user.role !== role) return <div className="p-8"><Skeleton className="mb-4 h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  return <>{children}</>;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useAsync(() => api<{ unread: number; items: NotificationRow[] }>("/notifications", { query: { pageSize: 8 } }), []);
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]); // polling fallback; live push comes with the real-time phase
  const markAll = async () => { await api("/notifications/read-all", { method: "POST" }); reload(); };
  return (
    <div className="relative">
      <button onClick={() => { setOpen((o) => !o); if (!open) reload(); }} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`} aria-expanded={open} className="relative rounded-lg p-2 text-muted hover:text-ink">
        <Bell className="h-5 w-5" />{!!data?.unread && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-lime px-1 text-[10px] font-bold text-bg">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-line bg-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Notifications</p>{!!data?.unread && <button onClick={markAll} className="text-xs text-lime hover:underline">Mark all read</button>}</div>
          {!data?.items.length ? <p className="py-6 text-center text-sm text-muted">Nothing yet</p> : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">{data.items.map((n) => (
              <li key={n.id} className={cx("rounded-lg px-2 py-2 text-sm", !n.readAt && "bg-lime/5")}><p className="font-medium">{n.title}</p><p className="text-xs text-muted">{n.body}</p><p className="mt-1 text-[11px] text-muted">{dateTime(n.createdAt)}</p></li>))}</ul>)}
        </div>)}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(); const path = usePathname(); const router = useRouter();
  const [collapsed, setCollapsed] = useState(false); const [mobile, setMobile] = useState(false); const [q, setQ] = useState("");
  useEffect(() => { try { setCollapsed(localStorage.getItem("sidebar") === "1"); } catch { /* storage unavailable */ } }, []);
  useEffect(() => setMobile(false), [path]);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("sidebar", c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map((n) => { const active = path.startsWith(n.href); return (
        <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} title={collapsed ? n.label : undefined}
          className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition", active ? "bg-lime/15 text-lime" : "text-muted hover:bg-white/5 hover:text-ink")}>
          <n.icon className="h-5 w-5 shrink-0" aria-hidden /><span className={cx(collapsed && "lg:hidden")}>{n.label}</span></Link>); })}
    </nav>
  );
  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-lime focus:px-3 focus:py-1 focus:text-bg">Skip to content</a>
      <aside className={cx("hidden shrink-0 flex-col border-r border-line bg-bg2 p-3 lg:flex", collapsed ? "w-[68px]" : "w-60")}>
        <Link href="/" className="mb-6 flex items-center gap-2 px-2 py-1 font-semibold"><span className="grid h-7 w-7 place-items-center rounded-md bg-lime text-bg"><Boxes className="h-4 w-4" /></span><span className={cx(collapsed && "hidden")}>Smart Inventory</span></Link>
        {nav}
        <button onClick={toggle} className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:text-ink" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}<span className={cx(collapsed && "hidden")}>Collapse</span></button>
      </aside>
      {mobile && <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setMobile(false)}><aside className="h-full w-64 bg-bg2 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between px-2"><span className="font-semibold">Smart Inventory</span><button aria-label="Close menu" onClick={() => setMobile(false)}><X className="h-5 w-5" /></button></div>{nav}</aside></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
          <button className="rounded-lg p-2 text-muted hover:text-ink lg:hidden" aria-label="Open menu" onClick={() => setMobile(true)}><Menu className="h-5 w-5" /></button>
          <form className="relative max-w-md flex-1" role="search" onSubmit={(e) => { e.preventDefault(); router.push(`/shop/products?q=${encodeURIComponent(q)}`); }}>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden /><input aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products or SKU" className="field pl-9" /></form>
          <div className="ml-auto flex items-center gap-1"><NotificationBell />
            <div className="hidden px-2 text-right text-xs sm:block"><p className="font-medium">{user?.name}</p><p className="text-muted">Shop owner</p></div>
            <Button variant="ghost" size="sm" onClick={async () => { await logout(); router.replace("/login"); }} aria-label="Log out"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Log out</span></Button></div>
        </header>
        {user?.status === "PENDING" && <div className="px-4 pt-4 sm:px-8"><Alert tone="amber">Your account is awaiting admin verification. You can browse, but adding products, selling and ordering unlock once it is approved.</Alert></div>}
        <main id="main" className="min-w-0 flex-1 p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
