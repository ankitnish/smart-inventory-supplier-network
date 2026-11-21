"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { History, SlidersHorizontal } from "lucide-react";
import { api, toApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { InventoryRow, Movement, Paged } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pager, Table, TableSkeleton, stockLabel, stockTone } from "@/components/ui";

const schema = z.object({ delta: z.string().regex(/^-?\d{1,6}$/, "Whole number, e.g. 12 or -3").refine((v) => Number(v) !== 0, "Cannot be zero"), reason: z.string().trim().min(3, "A reason is required").max(200) });
type V = z.infer<typeof schema>;

function Adjust({ row, onClose, onDone }: { row: InventoryRow | null; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema) });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={!!row} onClose={onClose} title={`Adjust stock: ${row?.name ?? ""}`}>
      <form noValidate className="space-y-4" onSubmit={handleSubmit(async (v) => { setErr(null); try { await api(`/inventory/${row!.inventoryId}/adjust`, { method: "POST", body: { delta: Number(v.delta), reason: v.reason } }); reset(); onDone(); onClose(); } catch (e) { setErr(toApiError(e).message); } })}>
        <p className="text-sm text-muted">On hand: <b className="text-ink">{row?.quantity}</b>. Use a positive number to add stock and a negative one to remove it. Every adjustment is recorded with your reason.</p>
        {err && <Alert>{err}</Alert>}
        <Input label="Change (+/-)" inputMode="numeric" error={errors.delta?.message} {...register("delta")} /><Input label="Reason" placeholder="e.g. Recount after stocktake" error={errors.reason?.message} {...register("reason")} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Save adjustment</Button></div>
      </form>
    </Modal>
  );
}

function HistoryModal({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => (row ? api<Paged<Movement>>(`/inventory/${row.inventoryId}/movements`, { query: { page, pageSize: 10 } }) : Promise.resolve(null)), [row?.inventoryId, page]);
  return (
    <Modal open={!!row} onClose={onClose} title={`Stock history: ${row?.name ?? ""}`} wide>
      {loading ? <TableSkeleton rows={4} /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No movements yet" /> : (
        <><Table><thead><tr className="border-b border-line"><th className="th">When</th><th className="th">Type</th><th className="th text-right">Change</th><th className="th text-right">Balance</th><th className="th">Reason</th></tr></thead>
          <tbody>{data.items.map((m) => <tr key={m.id} className="border-b border-line/60"><td className="td text-muted">{dateTime(m.createdAt)}</td><td className="td"><Badge>{m.type.replace("_", " ").toLowerCase()}</Badge></td>
            <td className={`td text-right font-medium ${m.delta < 0 ? "text-danger" : "text-emerald"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</td><td className="td text-right">{m.balanceAfter}</td><td className="td text-muted">{m.reason}</td></tr>)}</tbody></Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
    </Modal>
  );
}

export default function InventoryPage() {
  const { data, error, loading, reload } = useAsync(() => api<InventoryRow[]>("/inventory"), []);
  const [adj, setAdj] = useState<InventoryRow | null>(null); const [hist, setHist] = useState<InventoryRow | null>(null);
  return (
    <>
      <PageHeader title="Inventory" sub="Stock levels, thresholds and an audit trail of every change." />
      <Card>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.length ? <EmptyState title="No inventory yet" hint="Add products first; their stock appears here." /> : (
          <Table><thead><tr className="border-b border-line"><th className="th">Product</th><th className="th text-right">On hand</th><th className="th text-right">Reserved</th><th className="th text-right">Available</th><th className="th text-right">Min</th><th className="th text-right">Reorder at</th><th className="th">Status</th><th className="th">Updated</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.map((r) => (<tr key={r.inventoryId} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]">
              <td className="td"><p className="font-medium">{r.name}</p><p className="font-mono text-xs text-muted">{r.sku}</p>
                {r.perishable && <p className="mt-1 flex flex-wrap gap-1"><Badge tone="amber">{r.sellableQuantity ?? 0} sellable</Badge>{!!r.expiredQuantity && <Badge tone="red">{r.expiredQuantity} expired</Badge>}</p>}</td>
              <td className="td text-right">{r.quantity}</td><td className="td text-right text-muted">{r.reserved}</td><td className="td text-right">{r.available}</td><td className="td text-right text-muted">{r.minLevel}</td><td className="td text-right text-muted">{r.reorderPoint}</td>
              <td className="td"><Badge tone={stockTone(r.status)}>{stockLabel(r.status)}</Badge></td><td className="td text-xs text-muted">{dateTime(r.updatedAt)}</td>
              <td className="td"><div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" disabled={r.perishable} title={r.perishable ? "Perishable stock changes through receipts, sales and expiry write-offs" : "Adjust stock"} aria-label={`Adjust ${r.name}`} onClick={() => setAdj(r)}><SlidersHorizontal className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" aria-label={`History for ${r.name}`} onClick={() => setHist(r)}><History className="h-4 w-4" /></Button></div></td></tr>))}</tbody></Table>)}
      </Card>
      <Adjust row={adj} onClose={() => setAdj(null)} onDone={reload} /><HistoryModal row={hist} onClose={() => setHist(null)} />
    </>
  );
}
