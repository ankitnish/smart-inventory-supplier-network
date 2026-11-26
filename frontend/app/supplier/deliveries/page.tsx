"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { DeliveryRow, Paged } from "@/lib/types";
import { dateOnly, dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pager, Table, TableSkeleton } from "@/components/ui";

const tone = { PREPARING: "gray", IN_TRANSIT: "lime", DELIVERED: "green", FAILED: "red" } as const;
const label = (s: string) => s.toLowerCase().replace("_", " ");

export default function SupplierDeliveriesPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => api<Paged<DeliveryRow>>("/supplier/deliveries", { query: { page, pageSize: 15 } }), [page]);
  return (
    <>
      <PageHeader title="Deliveries" sub="Every shipment you have dispatched. Ship an order from Incoming orders to create one." />
      <Card>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No deliveries yet" hint="Shipments appear here once you ship an order." /> : (
          <><Table><thead><tr className="border-b border-line"><th className="th">Reference</th><th className="th">Order</th><th className="th">Status</th><th className="th">Dispatched</th><th className="th">Estimated</th><th className="th">Delivered</th><th className="th">Tracking</th></tr></thead>
            <tbody>{data.items.map((d) => <tr key={d.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td font-mono text-xs">{d.reference}</td><td className="td font-mono text-xs">{d.order.number}</td>
              <td className="td"><Badge tone={tone[d.status as keyof typeof tone] ?? "gray"}>{label(d.status)}</Badge></td><td className="td text-muted">{d.dispatchedAt ? dateTime(d.dispatchedAt) : "—"}</td>
              <td className="td text-muted">{d.estimatedAt ? dateOnly(d.estimatedAt) : "—"}</td><td className="td text-muted">{d.deliveredAt ? dateTime(d.deliveredAt) : "—"}</td><td className="td text-muted">{d.tracking ?? "—"}</td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
    </>
  );
}
