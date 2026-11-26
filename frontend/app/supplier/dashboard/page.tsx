"use client";
import Link from "next/link";
import { ReactNode } from "react";
import { AlertTriangle, Boxes, CheckCircle2, ClipboardList, Coins, PackageCheck, Truck } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { SupplierDashboard } from "@/lib/types";
import { dateTime, money, num } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";

function Stat({ icon, label, value, sub, href, highlight }: { icon: ReactNode; label: string; value: string; sub?: string; href?: string; highlight?: boolean }) {
  const body = (<Card className={`h-full transition hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-glow ${highlight ? "border-lime/40" : ""}`}><div className="flex items-center justify-between text-muted"><span className="text-xs uppercase tracking-wide">{label}</span>{icon}</div>
    <p className="mt-2 text-2xl font-semibold text-lime">{value}</p>{sub && <p className="mt-1 text-xs text-muted">{sub}</p>}</Card>);
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
const pretty = (a: string) => a.replace("purchase-order.", "Order ").replace("supplier-stock.", "Stock ").replace(/[-.]/g, " ");

export default function SupplierDashboardPage() {
  const { data: d, error, loading, reload } = useAsync(() => api<SupplierDashboard>("/supplier/dashboard"), []);
  if (loading) return <><PageHeader title="Dashboard" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div></>;
  if (error || !d) return <><PageHeader title="Dashboard" /><Card><ErrorState error={error!} retry={reload} /></Card></>;
  return (
    <>
      <PageHeader title="Dashboard" sub="Your listings, incoming orders and deliveries at a glance." />
      {d.listedProducts === 0 && <div className="mb-4"><Card><EmptyState title="You have no product listings yet" hint="List products with a price and lead time so shops can order from you." action={<Link href="/supplier/products" className="rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-bg">Add a listing</Link>} /></Card></div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<ClipboardList className="h-4 w-4" />} label="Awaiting your response" value={num(d.awaitingAcceptance)} sub="new orders to accept or reject" href="/supplier/orders" highlight={d.awaitingAcceptance > 0} />
        <Stat icon={<PackageCheck className="h-4 w-4" />} label="In processing" value={num(d.processing)} sub="accepted, not yet shipped" href="/supplier/orders" />
        <Stat icon={<Truck className="h-4 w-4" />} label="Shipped" value={num(d.shipped)} sub="on their way to shops" href="/supplier/deliveries" />
        <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Completed deliveries" value={num(d.completed)} href="/supplier/orders" />
        <Stat icon={<Coins className="h-4 w-4" />} label="Delivered order value" value={money(d.deliveredValue)} />
        <Stat icon={<Boxes className="h-4 w-4" />} label="Listed products" value={num(d.listedProducts)} sub={`${d.activeListings} active`} href="/supplier/products" />
        <Stat icon={<Truck className="h-4 w-4" />} label="Incoming orders" value={num(d.incomingOrders)} sub="submitted through shipped" href="/supplier/orders" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Low-stock listings</h2><Link href="/supplier/inventory" className="text-xs text-lime hover:underline">Manage stock</Link></div>
          {!d.lowStock.length ? <p className="py-4 text-sm text-muted">All active listings are well stocked.</p> :
            <ul className="space-y-2 text-sm">{d.lowStock.map((l) => <li key={l.id} className="flex items-center justify-between gap-2"><span>{l.product.name} <span className="font-mono text-xs text-muted">{l.product.sku}</span></span>
              <Badge tone={l.quantity === 0 ? "red" : "amber"}><AlertTriangle className="mr-1 h-3 w-3" aria-hidden />{l.quantity} left</Badge></li>)}</ul>}</Card>
        <Card><h2 className="mb-3 font-medium">Recent activity</h2>
          {!d.recentActivity.length ? <p className="py-4 text-sm text-muted">Order activity will appear here.</p> :
            <ul className="space-y-2 text-sm">{d.recentActivity.map((a) => <li key={a.id} className="flex justify-between gap-2"><span className="capitalize">{pretty(a.action)}</span><span className="text-xs text-muted">{dateTime(a.createdAt)}</span></li>)}</ul>}</Card>
      </div>
    </>
  );
}
