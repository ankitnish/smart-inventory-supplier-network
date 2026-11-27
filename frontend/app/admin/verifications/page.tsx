"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { AccountStatus, AdminUserRow, Paged } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pager, Table, TableSkeleton, accountTone, cx } from "@/components/ui";
import { UserModal } from "@/components/admin/UserModal";

const FILTERS: [string, AccountStatus | ""][] = [["Waiting for review", "PENDING"], ["Approved", "ACTIVE"], ["Rejected", "REJECTED"], ["Suspended", "SUSPENDED"], ["All", ""]];

export default function VerificationsPage() {
  const [role, setRole] = useState<"SHOP_OWNER" | "SUPPLIER">("SHOP_OWNER"); const [status, setStatus] = useState<AccountStatus | "">("PENDING");
  const [page, setPage] = useState(1); const [sel, setSel] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api<Paged<AdminUserRow>>("/admin/users", { query: { role, status, page, pageSize: 15 } }), [role, status, page]);
  return (
    <>
      <PageHeader title="Verifications" sub="Review shop and supplier applications. Every decision is recorded and the applicant is notified." />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1" role="tablist" aria-label="Account type">{([["SHOP_OWNER", "Shops"], ["SUPPLIER", "Suppliers"]] as const).map(([r, l]) =>
            <button key={r} role="tab" aria-selected={role === r} onClick={() => { setRole(r); setPage(1); }} className={cx("rounded-lg px-3 py-1.5 text-sm", role === r ? "bg-lime/15 text-lime" : "text-muted hover:text-ink")}>{l}</button>)}</div>
          <select aria-label="Filter by status" className="field ml-auto w-auto" value={status} onChange={(e) => { setStatus(e.target.value as AccountStatus | ""); setPage(1); }}>{FILTERS.map(([l, v]) => <option key={l} value={v}>{l}</option>)}</select></div>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title={status === "PENDING" ? "No applications waiting" : "Nothing matches this filter"} hint={status === "PENDING" ? "New sign-ups will appear here for review." : undefined} /> : (
          <><Table><thead><tr className="border-b border-line"><th className="th">Business</th><th className="th">Contact</th><th className="th">Address</th><th className="th">Registered</th><th className="th">Status</th><th className="th"><span className="sr-only">Review</span></th></tr></thead>
            <tbody>{data.items.map((u) => <tr key={u.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td font-medium">{u.business?.name ?? "—"}</td>
              <td className="td"><p>{u.name}</p><p className="text-xs text-muted">{u.email}</p></td><td className="td text-muted">{u.business?.address ?? "not provided"}</td><td className="td text-muted">{dateTime(u.createdAt)}</td>
              <td className="td"><Badge tone={accountTone[u.status]}>{u.status.toLowerCase()}</Badge></td>
              <td className="td text-right"><Button size="sm" variant={u.status === "PENDING" ? "primary" : "outline"} onClick={() => setSel(u.id)}>{u.status === "PENDING" ? "Review" : "View"}</Button></td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
      <UserModal userId={sel} onClose={() => setSel(null)} onChanged={reload} />
    </>
  );
}
