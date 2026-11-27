"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync, useDebounced } from "@/lib/hooks";
import { AuditRow, Paged } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pager, Table, TableSkeleton, prettyAction } from "@/components/ui";

const ENTITIES = ["User", "Product", "Category", "PurchaseOrder", "SupplierProduct", "ShopInventory", "Shop", "Recommendation"];
const brief = (m: unknown) => { if (!m || typeof m !== "object") return ""; const s = JSON.stringify(m); return s.length > 90 ? s.slice(0, 90) + "…" : s; };

export default function AuditPage() {
  const [action, setAction] = useState(""); const da = useDebounced(action); const [entity, setEntity] = useState(""); const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => api<Paged<AuditRow>>("/admin/audit-logs", { query: { action: da, entity, page, pageSize: 25 } }), [da, entity, page]);
  return (
    <>
      <PageHeader title="Audit log" sub="A record of who did what. Entries cannot be edited or deleted from the app." />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden /><input aria-label="Filter by action" className="field pl-9" placeholder="Filter by action, e.g. user.rejected" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} /></div>
          <select aria-label="Filter by record type" className="field w-auto" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">All record types</option>{ENTITIES.map((e) => <option key={e}>{e}</option>)}</select></div>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No entries match" /> : (
          <><Table><thead><tr className="border-b border-line"><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Record</th><th className="th">Details</th></tr></thead>
            <tbody>{data.items.map((a) => <tr key={a.id} className="border-b border-line/60 last:border-0 align-top hover:bg-white/[.02]"><td className="td whitespace-nowrap text-muted">{dateTime(a.createdAt)}</td><td className="td">{a.actor}</td>
              <td className="td">{prettyAction(a.action)}</td><td className="td"><Badge>{a.entity}</Badge></td><td className="td"><code className="text-xs text-muted" title={JSON.stringify(a.metadata)}>{brief(a.metadata)}</code></td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
    </>
  );
}
