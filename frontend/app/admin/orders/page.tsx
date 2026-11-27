"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { AdminOrderRow, Paged } from "@/lib/types";
import { dateTime, money } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pager, Table, TableSkeleton, orderTone } from "@/components/ui";

const STATUSES = ["SUBMITTED", "ACCEPTED", "PROCESSING", "SHIPPED", "DELIVERED", "REJECTED", "CANCELLED"] as const;
export default function AdminOrdersPage() {
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => api<Paged<AdminOrderRow>>("/admin/orders", { query: { status, page, pageSize: 20 } }), [status, page]);
  return (
    <>
      <PageHeader title="Orders" sub="Purchase-order activity across all shops and suppliers (drafts are not shown)." />
      <Card>
        <div className="mb-4"><select aria-label="Filter by status" className="field w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></div>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No orders yet" hint="Orders appear here once shops submit them." /> : (
          <><Table><thead><tr className="border-b border-line"><th className="th">Order</th><th className="th">Shop</th><th className="th">Supplier</th><th className="th">Status</th><th className="th">Created</th><th className="th text-right">Total</th></tr></thead>
            <tbody>{data.items.map((o) => <tr key={o.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td font-mono text-xs">{o.number}</td><td className="td">{o.shop}</td><td className="td">{o.supplier}</td>
              <td className="td"><Badge tone={orderTone[o.status]}>{o.status.toLowerCase()}</Badge></td><td className="td text-muted">{dateTime(o.createdAt)}</td><td className="td text-right">{money(o.total)}</td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
    </>
  );
}
