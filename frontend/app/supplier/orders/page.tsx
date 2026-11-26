"use client";
import { useState } from "react";
import { api, toApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { Paged, SupplierOrderDetail, SupplierOrderRow } from "@/lib/types";
import { dateOnly, dateTime, money } from "@/lib/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pager, Table, TableSkeleton, Textarea, orderTone } from "@/components/ui";

const STATUSES = ["SUBMITTED", "ACCEPTED", "PROCESSING", "SHIPPED", "DELIVERED", "REJECTED", "CANCELLED"] as const;
const NEXT_HINT: Record<string, string> = {
  SUBMITTED: "Accepting reserves the ordered quantity from your stock.", ACCEPTED: "Start processing once you begin preparing the goods.",
  PROCESSING: "Ship when the goods leave you. Perishable items need an expiry date.", SHIPPED: "Mark delivered when the goods have arrived. The shop then confirms receipt to update its stock.",
};

function OrderModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data: o, error, loading, reload } = useAsync(() => (id ? api<SupplierOrderDetail>(`/supplier/orders/${id}`) : Promise.resolve(null)), [id]);
  const [mode, setMode] = useState<null | "reject" | "ship">(null); const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const [reason, setReason] = useState(""); const [eta, setEta] = useState(""); const [tracking, setTracking] = useState("");
  const [exp, setExp] = useState<Record<string, string>>({}); const [lot, setLot] = useState<Record<string, string>>({});
  const needsExpiry = o?.items.filter((i) => i.product?.perishable && !i.expiryDate) ?? [];

  const act = async (name: string, path: string, body?: unknown, msg?: string) => {
    setBusy(name); setErr(null); setOk(null);
    try { await api(`/supplier/orders/${id}/${path}`, { method: "POST", body }); setOk(msg ?? "Done"); setMode(null); reload(); onChanged(); }
    catch (e) { setErr(toApiError(e).message); } finally { setBusy(null); }
  };
  const close = () => { setMode(null); setErr(null); setOk(null); setReason(""); setExp({}); setLot({}); onClose(); };

  return (
    <Modal open={!!id} onClose={close} title={o ? `Order ${o.number}` : "Order"} wide>
      {loading ? <TableSkeleton rows={4} /> : error ? <ErrorState error={error} retry={reload} /> : o && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm"><Badge tone={orderTone[o.status]}>{o.status.toLowerCase()}</Badge>
            <span className="text-muted">Shop: <b className="text-ink">{o.shop.name}</b>{o.shop.address ? ` · ${o.shop.address}` : ""}</span><span className="text-muted">Placed {dateTime(o.createdAt)}</span>
            <span className="ml-auto text-lg font-semibold text-lime">{money(o.total)}</span></div>
          {o.rejectionReason && <Alert>Rejected: {o.rejectionReason}</Alert>}{err && <Alert>{err}</Alert>}{ok && <Alert tone="green">{ok}</Alert>}
          <Table><thead><tr className="border-b border-line"><th className="th">Product</th><th className="th text-right">Qty</th><th className="th text-right">Unit price</th><th className="th text-right">Line total</th><th className="th">Expiry</th></tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.id} className="border-b border-line/60"><td className="td">{i.product?.name ?? "—"}<p className="font-mono text-xs text-muted">{i.product?.sku}</p></td><td className="td text-right">{i.quantity}</td>
              <td className="td text-right">{money(i.unitPrice)}</td><td className="td text-right">{money(i.lineTotal)}</td><td className="td text-muted">{i.product?.perishable ? (i.expiryDate ? dateOnly(i.expiryDate) : "required to ship") : "—"}</td></tr>)}</tbody></Table>
          {!!o.deliveries.length && <div className="text-sm"><p className="mb-1 font-medium">Delivery</p>{o.deliveries.map((d) => <p key={d.id} className="text-muted">{d.reference} · {d.status.toLowerCase().replace("_", " ")}{d.estimatedAt && ` · est. ${dateOnly(d.estimatedAt)}`}{d.tracking && ` · tracking ${d.tracking}`}</p>)}</div>}
          <div className="text-sm"><p className="mb-1 font-medium">History</p><ul className="space-y-1 text-muted">{o.history.map((h) => <li key={h.id}>{dateTime(h.at)} — {h.from ? `${h.from.toLowerCase()} → ` : ""}{h.to.toLowerCase()}{h.note && ` (${h.note})`}</li>)}</ul></div>

          {mode === "reject" && <div className="space-y-3 rounded-lg border border-danger/30 p-3"><Textarea label="Reason for rejecting (the shop will see this)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setMode(null)}>Back</Button>
              <Button variant="danger" size="sm" loading={busy === "reject"} disabled={reason.trim().length < 3} onClick={() => act("reject", "reject", { reason: reason.trim() }, "Order rejected.")}>Confirm rejection</Button></div></div>}
          {mode === "ship" && <div className="space-y-3 rounded-lg border border-line p-3"><div className="grid gap-3 sm:grid-cols-2"><Input label="Estimated delivery date (optional)" type="date" value={eta} onChange={(e) => setEta(e.target.value)} /><Input label="Tracking reference (optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
            {needsExpiry.length > 0 && <div className="space-y-2"><p className="text-sm text-amber">Perishable items need an expiry date before they can ship.</p>
              {needsExpiry.map((i) => <div key={i.id} className="grid gap-3 sm:grid-cols-2"><Input label={`${i.product?.name}: expiry date`} type="date" value={exp[i.id] ?? ""} onChange={(e) => setExp((x) => ({ ...x, [i.id]: e.target.value }))} />
                <Input label="Lot code (optional)" value={lot[i.id] ?? ""} onChange={(e) => setLot((x) => ({ ...x, [i.id]: e.target.value }))} /></div>)}</div>}
            <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setMode(null)}>Back</Button>
              <Button size="sm" loading={busy === "ship"} disabled={needsExpiry.some((i) => !exp[i.id])} onClick={() => act("ship", "ship", { estimatedAt: eta || undefined, tracking: tracking.trim() || undefined,
                items: needsExpiry.map((i) => ({ itemId: i.id, expiryDate: exp[i.id], lotCode: lot[i.id]?.trim() || undefined })) }, "Order marked as shipped.")}>Confirm shipment</Button></div></div>}

          {NEXT_HINT[o.status] && !mode && <p className="text-xs text-muted">{NEXT_HINT[o.status]}</p>}
          {!mode && <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {o.status === "SUBMITTED" && <><Button variant="danger" onClick={() => { setErr(null); setMode("reject"); }}>Reject</Button><Button loading={busy === "accept"} onClick={() => act("accept", "accept", undefined, "Order accepted and stock reserved.")}>Accept order</Button></>}
            {o.status === "ACCEPTED" && <Button loading={busy === "process"} onClick={() => act("process", "process", undefined, "Order is now processing.")}>Start processing</Button>}
            {o.status === "PROCESSING" && <Button onClick={() => { setErr(null); setMode("ship"); }}>Ship order</Button>}
            {o.status === "SHIPPED" && <Button loading={busy === "deliver"} onClick={() => act("deliver", "deliver", undefined, "Marked as delivered. The shop will confirm receipt.")}>Mark delivered</Button>}
          </div>}
        </div>)}
    </Modal>
  );
}

export default function SupplierOrdersPage() {
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const [sel, setSel] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api<Paged<SupplierOrderRow>>("/supplier/orders", { query: { status, page, pageSize: 15 } }), [status, page]);
  return (
    <>
      <PageHeader title="Incoming orders" sub="Orders shops have submitted to you. Accept, prepare, ship and deliver them here." />
      <Card>
        <div className="mb-4"><select aria-label="Filter by status" className="field w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></div>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No orders yet" hint="When a shop submits an order to you, it will appear here." /> : (
          <><Table><thead><tr className="border-b border-line"><th className="th">Order</th><th className="th">Shop</th><th className="th">Status</th><th className="th">Placed</th><th className="th text-right">Total</th><th className="th"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{data.items.map((o) => <tr key={o.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td font-mono text-xs">{o.number}</td><td className="td">{o.shop.name}</td>
              <td className="td"><Badge tone={orderTone[o.status]}>{o.status.toLowerCase()}</Badge></td><td className="td text-muted">{dateTime(o.createdAt)}</td><td className="td text-right">{money(o.total)}</td>
              <td className="td text-right"><Button variant={o.status === "SUBMITTED" ? "primary" : "outline"} size="sm" onClick={() => setSel(o.id)}>{o.status === "SUBMITTED" ? "Review" : "Open"}</Button></td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
      <OrderModal id={sel} onClose={() => setSel(null)} onChanged={reload} />
    </>
  );
}
