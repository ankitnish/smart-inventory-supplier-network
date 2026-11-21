"use client";
import { useState } from "react";
import { api, toApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { OrderDetail, OrderRow, Paged } from "@/lib/types";
import { dateOnly, dateTime, money } from "@/lib/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pager, Table, TableSkeleton } from "@/components/ui";

const tone = { DRAFT: "gray", SUBMITTED: "amber", ACCEPTED: "lime", PROCESSING: "lime", SHIPPED: "lime", DELIVERED: "green", REJECTED: "red", CANCELLED: "gray" } as const;
const STATUSES = ["DRAFT", "SUBMITTED", "ACCEPTED", "PROCESSING", "SHIPPED", "DELIVERED", "REJECTED", "CANCELLED"] as const;

function OrderModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data: o, error, loading, reload } = useAsync(() => (id ? api<OrderDetail>(`/purchase-orders/${id}`) : Promise.resolve(null)), [id]);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const [exp, setExp] = useState<Record<string, string>>({});
  const act = async (name: string, path: string, body?: unknown, msg?: string) => { setBusy(name); setErr(null); setOk(null); try { await api(`/purchase-orders/${id}/${path}`, { method: "POST", body }); setOk(msg ?? "Done"); reload(); onChanged(); } catch (e) { setErr(toApiError(e).message); } finally { setBusy(null); } };
  const needsExpiry = o?.items.filter((i) => i.product?.perishable && !i.expiryDate) ?? [];
  const canReceive = !!o && (o.status === "SHIPPED" || o.status === "DELIVERED") && !o.receivedAt;
  return (
    <Modal open={!!id} onClose={onClose} title={o ? `Order ${o.number}` : "Order"} wide>
      {loading ? <TableSkeleton rows={4} /> : error ? <ErrorState error={error} retry={reload} /> : o && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm"><Badge tone={tone[o.status]}>{o.status.toLowerCase()}</Badge><span className="text-muted">Supplier: <b className="text-ink">{o.supplier.name}</b></span><span className="text-muted">Created {dateTime(o.createdAt)}</span><span className="ml-auto text-lg font-semibold text-lime">{money(o.total)}</span></div>
          {o.rejectionReason && <Alert>Rejected: {o.rejectionReason}</Alert>}{err && <Alert>{err}</Alert>}{ok && <Alert tone="green">{ok}</Alert>}
          <Table><thead><tr className="border-b border-line"><th className="th">Product</th><th className="th text-right">Qty</th><th className="th text-right">Unit price</th><th className="th text-right">Line total</th><th className="th">Expiry</th></tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.id} className="border-b border-line/60"><td className="td">{i.product?.name ?? "—"}<p className="font-mono text-xs text-muted">{i.product?.sku}</p></td><td className="td text-right">{i.quantity}</td><td className="td text-right">{money(i.unitPrice)}</td><td className="td text-right">{money(i.lineTotal)}</td>
              <td className="td text-muted">{i.product?.perishable ? (i.expiryDate ? dateOnly(i.expiryDate) : "not declared") : "—"}</td></tr>)}</tbody></Table>
          {!!o.deliveries.length && <div className="text-sm"><p className="mb-1 font-medium">Delivery</p>{o.deliveries.map((d) => <p key={d.id} className="text-muted">{d.reference} · {d.status.toLowerCase().replace("_", " ")}{d.estimatedAt && ` · est. ${dateOnly(d.estimatedAt)}`}{d.tracking && ` · tracking ${d.tracking}`}</p>)}</div>}
          <div className="text-sm"><p className="mb-1 font-medium">History</p><ul className="space-y-1 text-muted">{o.history.map((h) => <li key={h.id}>{dateTime(h.at)} — {h.from ? `${h.from.toLowerCase()} → ` : ""}{h.to.toLowerCase()}{h.note && ` (${h.note})`}</li>)}</ul></div>
          {canReceive && needsExpiry.length > 0 && <div className="rounded-lg border border-amber/30 p-3"><p className="mb-2 text-sm text-amber">The supplier did not declare expiry dates for these perishable items. Enter them from the packaging to receive.</p>
            <div className="grid gap-3 sm:grid-cols-2">{needsExpiry.map((i) => <Input key={i.id} label={`${i.product?.name} expiry`} type="date" value={exp[i.id] ?? ""} onChange={(e) => setExp((x) => ({ ...x, [i.id]: e.target.value }))} />)}</div></div>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {o.status === "DRAFT" && <Button loading={busy === "submit"} onClick={() => act("submit", "submit", undefined, "Order submitted to the supplier.")}>Submit to supplier</Button>}
            {["DRAFT", "SUBMITTED", "ACCEPTED"].includes(o.status) && <Button variant="danger" loading={busy === "cancel"} onClick={() => act("cancel", "cancel", undefined, "Order cancelled.")}>Cancel order</Button>}
            {canReceive && <Button loading={busy === "receive"} disabled={needsExpiry.some((i) => !exp[i.id])} onClick={() => act("receive", "receive", { expiry: Object.fromEntries(needsExpiry.map((i) => [i.id, exp[i.id]])) }, "Goods received and stock updated.")}>Confirm goods received</Button>}
            {o.receivedAt && <p className="self-center text-sm text-emerald">Received {dateTime(o.receivedAt)}</p>}
          </div>
        </div>)}
    </Modal>
  );
}

export default function PurchaseOrdersPage() {
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const [sel, setSel] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api<Paged<OrderRow>>("/purchase-orders", { query: { status, page, pageSize: 15 } }), [status, page]);
  return (
    <>
      <PageHeader title="Purchase orders" sub="Track every order from draft to delivery. Stock is added only when you confirm goods received." />
      <Card>
        <div className="mb-4"><select aria-label="Filter by status" className="field w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></div>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No purchase orders" hint="Create one from a confirmed recommendation." /> : (
          <><Table><thead><tr className="border-b border-line"><th className="th">Order</th><th className="th">Supplier</th><th className="th">Status</th><th className="th">Created</th><th className="th text-right">Total</th><th className="th"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{data.items.map((o) => <tr key={o.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td font-mono text-xs">{o.number}</td><td className="td">{o.supplier.name}</td><td className="td"><Badge tone={tone[o.status]}>{o.status.toLowerCase()}</Badge></td>
              <td className="td text-muted">{dateTime(o.createdAt)}</td><td className="td text-right">{money(o.total)}</td><td className="td text-right"><Button variant="outline" size="sm" onClick={() => setSel(o.id)}>Open</Button></td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
      <OrderModal id={sel} onClose={() => setSel(null)} onChanged={reload} />
    </>
  );
}
