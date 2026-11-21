"use client";
import Link from "next/link";
import { ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Boxes, Coins, PackageX, Sparkles, Truck, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { Summary } from "@/lib/types";
import { dateTime, money, num } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";

function Stat({ icon, label, value, sub, href }: { icon: ReactNode; label: string; value: string; sub?: string; href?: string }) {
  const body = (<Card className="h-full transition hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-glow"><div className="flex items-center justify-between text-muted"><span className="text-xs uppercase tracking-wide">{label}</span>{icon}</div>
    <p className="mt-2 text-2xl font-semibold text-lime">{value}</p>{sub && <p className="mt-1 text-xs text-muted">{sub}</p>}</Card>);
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default function Dashboard() {
  const { data: s, error, loading, reload } = useAsync(() => api<Summary>("/analytics/shop-summary"), []);
  if (loading) return <><PageHeader title="Dashboard" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="mt-4 h-72" /></>;
  if (error || !s) return <><PageHeader title="Dashboard" /><Card><ErrorState error={error!} retry={reload} /></Card></>;
  if (s.activeProducts === 0) return <><PageHeader title="Dashboard" /><Card><EmptyState title="Your inventory is empty" hint="Add your first product to start tracking stock, recording sales and getting recommendations." action={<Link href="/shop/products" className="rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-bg">Add a product</Link>} /></Card></>;
  const trend = s.salesTrend.map((d) => ({ date: d.date.slice(5), total: Number(d.total) }));
  const noSales = trend.every((d) => d.total === 0);
  return (
    <>
      <PageHeader title="Dashboard" sub="Live figures from your inventory, sales and orders." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat icon={<Boxes className="h-4 w-4" />} label="Active products" value={num(s.activeProducts)} href="/shop/products" />
        <Stat icon={<Wallet className="h-4 w-4" />} label="Inventory value (at cost)" value={money(s.inventoryValuation)} sub={`${num(s.totalUnits)} units on hand`} href="/shop/inventory" />
        <Stat icon={<Coins className="h-4 w-4" />} label="Today's sales" value={money(s.todaySales.total)} sub={`${s.todaySales.count} sale${s.todaySales.count === 1 ? "" : "s"}`} href="/shop/sales" />
        <Stat icon={<AlertTriangle className="h-4 w-4" />} label="Low stock" value={num(s.stock.low + s.stock.outOfStock)} sub={`${s.stock.outOfStock} out of stock · ${s.stock.needsReorder} near reorder point`} href="/shop/inventory" />
        <Stat icon={<Truck className="h-4 w-4" />} label="Open purchase orders" value={num(s.pendingOrders)} href="/shop/purchase-orders" />
        <Stat icon={<Sparkles className="h-4 w-4" />} label="Recommendations to review" value={num(s.pendingRecommendations)} href="/shop/recommendations" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><h2 className="mb-1 font-medium">Sales, last 14 days</h2><p className="mb-3 text-xs text-muted">Actual recorded sales. Forecasts are on the Recommendations page.</p>
          {noSales ? <EmptyState title="No sales in this period" hint="Record a sale and it will appear here." /> : (
            <div className="h-64" role="img" aria-label="Area chart of daily sales for the last 14 days"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ left: -10, right: 8, top: 8 }}>
              <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#B7F34A" stopOpacity={0.35} /><stop offset="100%" stopColor="#B7F34A" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="#262D27" vertical={false} /><XAxis dataKey="date" stroke="#9AA39A" fontSize={11} tickLine={false} /><YAxis stroke="#9AA39A" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#171C18", border: "1px solid #262D27", borderRadius: 8 }} formatter={(v) => [money(v as number), "Sales"]} />
              <Area type="monotone" dataKey="total" stroke="#B7F34A" strokeWidth={2} fill="url(#g)" /></AreaChart></ResponsiveContainer></div>)}</Card>
        <Card><h2 className="mb-3 font-medium">Recent notifications</h2>
          {!s.notifications.items.length ? <p className="py-6 text-center text-sm text-muted">Nothing yet</p> : <ul className="space-y-2">{s.notifications.items.map((n) => <li key={n.id} className="text-sm"><p className="font-medium">{n.title}</p><p className="text-xs text-muted">{n.body}</p></li>)}</ul>}</Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card><h2 className="mb-3 font-medium">Top selling (30 days)</h2>{!s.topSelling.length ? <p className="text-sm text-muted">No sales yet.</p> :
          <ul className="space-y-2 text-sm">{s.topSelling.map((t) => <li key={t.sku} className="flex justify-between"><span>{t.name}</span><Badge tone="lime">{t.unitsSold} sold</Badge></li>)}</ul>}</Card>
        <Card><h2 className="mb-3 font-medium">Slow moving</h2>{!s.slowMoving.length ? <p className="text-sm text-muted">Nothing to show.</p> :
          <ul className="space-y-2 text-sm">{s.slowMoving.map((t) => <li key={t.sku} className="flex justify-between gap-2"><span>{t.name}</span><span className="text-muted">{t.unitsSold30d} sold · {t.onHand} on hand</span></li>)}</ul>}</Card>
        <Card><h2 className="mb-3 font-medium">Recent sales</h2>{!s.recentSales.length ? <p className="text-sm text-muted">No sales yet.</p> :
          <ul className="space-y-2 text-sm">{s.recentSales.map((t) => <li key={t.id} className="flex justify-between"><span className="text-muted">{dateTime(t.soldAt)}</span><span>{money(t.total)}</span></li>)}</ul>}</Card>
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-muted"><PackageX className="h-3 w-3" aria-hidden />Demo accounts contain fictional seed data.</p>
    </>
  );
}
