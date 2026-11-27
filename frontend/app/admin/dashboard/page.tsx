"use client";
import Link from "next/link";
import { ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, Boxes, Coins, ShieldCheck, ShoppingCart, Store, Truck } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { AdminDashboard } from "@/lib/types";
import { dateTime, money, num } from "@/lib/format";
import { Alert, Badge, Card, ErrorState, PageHeader, Skeleton, prettyAction } from "@/components/ui";

function Stat({ icon, label, value, sub, href, highlight }: { icon: ReactNode; label: string; value: string; sub?: string; href?: string; highlight?: boolean }) {
  const body = (<Card className={`h-full transition hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-glow ${highlight ? "border-lime/40" : ""}`}><div className="flex items-center justify-between text-muted"><span className="text-xs uppercase tracking-wide">{label}</span>{icon}</div>
    <p className="mt-2 text-2xl font-semibold text-lime">{value}</p>{sub && <p className="mt-1 text-xs text-muted">{sub}</p>}</Card>);
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default function AdminDashboardPage() {
  const { data: d, error, loading, reload } = useAsync(() => api<AdminDashboard>("/admin/dashboard"), []);
  if (loading) return <><PageHeader title="Platform overview" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div></>;
  if (error || !d) return <><PageHeader title="Platform overview" /><Card><ErrorState error={error!} retry={reload} /></Card></>;
  const pending = d.pendingVerifications.shops + d.pendingVerifications.suppliers;
  const orders = Object.values(d.orders30d).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title="Platform overview" sub="Accounts, orders and system health across the whole platform." />
      {d.alerts.length > 0 && <div className="mb-4 space-y-2">{d.alerts.map((a) => <Alert key={a.message} tone={a.level === "critical" ? "red" : "amber"}><span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden />{a.message}</span></Alert>)}</div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<ShieldCheck className="h-4 w-4" />} label="Pending verifications" value={num(pending)} sub={`${d.pendingVerifications.shops} ${d.pendingVerifications.shops === 1 ? "shop" : "shops"} · ${d.pendingVerifications.suppliers} ${d.pendingVerifications.suppliers === 1 ? "supplier" : "suppliers"}`} href="/admin/verifications" highlight={pending > 0} />
        <Stat icon={<Store className="h-4 w-4" />} label="Registered shops" value={num(d.shops)} href="/admin/users" />
        <Stat icon={<Truck className="h-4 w-4" />} label="Registered suppliers" value={num(d.suppliers)} href="/admin/users" />
        <Stat icon={<Boxes className="h-4 w-4" />} label="Listed products" value={num(d.listedProducts.activeOffers)} sub={`${d.listedProducts.catalogProducts} in the catalog`} href="/admin/catalog" />
        <Stat icon={<ShoppingCart className="h-4 w-4" />} label="Orders (30 days)" value={num(orders)} sub={Object.entries(d.orders30d).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "none yet"} href="/admin/orders" />
        <Stat icon={<Coins className="h-4 w-4" />} label="Shop sales (30 days)" value={money(d.sales30d.total)} sub={`${d.sales30d.count} transactions`} />
        <Card><div className="flex items-center justify-between text-muted"><span className="text-xs uppercase tracking-wide">Forecasting service</span><Activity className="h-4 w-4" /></div>
          <p className="mt-2"><Badge tone={d.services.forecasting === "ok" ? "green" : "red"}>{d.services.forecasting === "ok" ? "Running" : "Not responding"}</Badge></p></Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><h2 className="mb-1 font-medium">Platform usage, last 14 days</h2><p className="mb-3 text-xs text-muted">Orders submitted and shop sales recorded per day.</p>
          <div className="h-64" role="img" aria-label="Line chart of daily orders and sales for the last 14 days"><ResponsiveContainer width="100%" height="100%"><LineChart data={d.usageTrend.map((t) => ({ ...t, date: t.date.slice(5) }))} margin={{ left: -15, right: 8, top: 8 }}>
            <CartesianGrid stroke="#262D27" vertical={false} /><XAxis dataKey="date" stroke="#9AA39A" fontSize={11} tickLine={false} /><YAxis stroke="#9AA39A" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#171C18", border: "1px solid #262D27", borderRadius: 8 }} /><Legend />
            <Line type="monotone" dataKey="sales" name="Sales" stroke="#B7F34A" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="orders" name="Orders" stroke="#35C98A" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></Card>
        <Card><div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Recent activity</h2><Link href="/admin/audit" className="text-xs text-lime hover:underline">Full audit log</Link></div>
          {!d.recentActivity.length ? <p className="py-4 text-sm text-muted">Nothing recorded yet.</p> : <ul className="space-y-2 text-sm">{d.recentActivity.map((a) => <li key={a.id}><p>{prettyAction(a.action)}</p><p className="text-xs text-muted">{a.actor} · {dateTime(a.createdAt)}</p></li>)}</ul>}</Card>
      </div>
    </>
  );
}
