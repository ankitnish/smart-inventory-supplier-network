"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync, useDebounced } from "@/lib/hooks";
import { AdminUserRow, Paged } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pager, Table, TableSkeleton, accountTone } from "@/components/ui";
import { UserModal } from "@/components/admin/UserModal";

const roleLabel = { SHOP_OWNER: "Shop owner", SUPPLIER: "Supplier", ADMIN: "Admin" } as const;

export default function UsersPage() {
  const [q, setQ] = useState(""); const dq = useDebounced(q); const [role, setRole] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const [sel, setSel] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api<Paged<AdminUserRow>>("/admin/users", { query: { q: dq, role, status, page, pageSize: 15 } }), [dq, role, status, page]);
  const reset = (f: () => void) => { f(); setPage(1); };
  return (
    <>
      <PageHeader title="Users" sub="Every account on the platform. Open one to see its details and activity, or to suspend or reactivate it." />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden /><input aria-label="Search users" className="field pl-9" placeholder="Search name, email or business" value={q} onChange={(e) => reset(() => setQ(e.target.value))} /></div>
          <select aria-label="Filter by role" className="field w-auto" value={role} onChange={(e) => reset(() => setRole(e.target.value))}><option value="">All roles</option><option value="SHOP_OWNER">Shop owners</option><option value="SUPPLIER">Suppliers</option><option value="ADMIN">Admins</option></select>
          <select aria-label="Filter by status" className="field w-auto" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}><option value="">All statuses</option><option value="PENDING">Pending</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="REJECTED">Rejected</option></select></div>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No users match" hint="Try a different search or filter." /> : (
          <><Table><thead><tr className="border-b border-line"><th className="th">Name</th><th className="th">Role</th><th className="th">Business</th><th className="th">Registered</th><th className="th">Status</th><th className="th"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{data.items.map((u) => <tr key={u.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td"><p className="font-medium">{u.name}</p><p className="text-xs text-muted">{u.email}</p></td>
              <td className="td text-muted">{roleLabel[u.role]}</td><td className="td text-muted">{u.business?.name ?? "—"}</td><td className="td text-muted">{dateTime(u.createdAt)}</td>
              <td className="td"><Badge tone={accountTone[u.status]}>{u.status.toLowerCase()}</Badge></td><td className="td text-right"><Button size="sm" variant="outline" onClick={() => setSel(u.id)}>View</Button></td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
      <UserModal userId={sel} onClose={() => setSel(null)} onChanged={reload} />
    </>
  );
}
