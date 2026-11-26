"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { History, SlidersHorizontal } from "lucide-react";
import { api, toApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { Listing, Movement, Paged } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pager, Table, TableSkeleton } from "@/components/ui";

const LOW = 20; // display threshold; the dashboard uses the same default
const schema = z.object({ delta: z.string().regex(/^-?\d{1,7}$/, "Whole number, e.g. 50 or -10").refine((v) => Number(v) !== 0, "Cannot be zero"), reason: z.string().trim().min(3, "A reason is required").max(200) });
type V = z.infer<typeof schema>;

function Adjust({ row, onClose, onDone }: { row: Listing | null; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema) });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={!!row} onClose={onClose} title={`Adjust stock: ${row?.product.name ?? ""}`}>
      <form noValidate className="space-y-4" onSubmit={handleSubmit(async (v) => { setErr(null); try { await api(`/supplier/products/${row!.id}/stock`, { method: "POST", body: { delta: Number(v.delta), reason: v.reason } }); reset(); onDone(); onClose(); } catch (e) { setErr(toApiError(e).message); } })}>
        <p className="text-sm text-muted">In stock: <b className="text-ink">{row?.quantity}</b>. Stock reserved for accepted orders is already deducted. Use a positive number to add and a negative one to remove. Every change is recorded with your reason.</p>
        {err && <Alert>{err}</Alert>}
        <Input label="Change (+/-)" inputMode="numeric" error={errors.delta?.message} {...register("delta")} /><Input label="Reason" placeholder="e.g. New delivery from factory" error={errors.reason?.message} {...register("reason")} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Save adjustment</Button></div>
      </form>
    </Modal>
  );
}

function HistoryModal({ row, onClose }: { row: Listing | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => (row ? api<Paged<Movement>>(`/supplier/products/${row.id}/movements`, { query: { page, pageSize: 10 } }) : Promise.resolve(null)), [row?.id, page]);
  return (
    <Modal open={!!row} onClose={onClose} title={`Stock history: ${row?.product.name ?? ""}`} wide>
      {loading ? <TableSkeleton rows={4} /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No stock changes yet" /> : (
        <><Table><thead><tr className="border-b border-line"><th className="th">When</th><th className="th text-right">Change</th><th className="th text-right">Balance</th><th className="th">Reason</th></tr></thead>
          <tbody>{data.items.map((m) => <tr key={m.id} className="border-b border-line/60"><td className="td text-muted">{dateTime(m.createdAt)}</td>
            <td className={`td text-right font-medium ${m.delta < 0 ? "text-danger" : "text-emerald"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</td><td className="td text-right">{m.balanceAfter}</td><td className="td text-muted">{m.reason}</td></tr>)}</tbody></Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
    </Modal>
  );
}

export default function SupplierInventoryPage() {
  const [page, setPage] = useState(1); const [adj, setAdj] = useState<Listing | null>(null); const [hist, setHist] = useState<Listing | null>(null);
  const { data, error, loading, reload } = useAsync(() => api<Paged<Listing>>("/supplier/products", { query: { page, pageSize: 20 } }), [page]);
  return (
    <>
      <PageHeader title="Inventory" sub="Your own stock, separate from any shop's. Accepting an order reserves its quantity automatically." />
      <Card>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? <EmptyState title="No stock to show" hint="Add product listings first." /> : (
          <><Table><thead><tr className="border-b border-line"><th className="th">Product</th><th className="th text-right">In stock</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.items.map((l) => <tr key={l.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td"><p className="font-medium">{l.product.name}</p><p className="font-mono text-xs text-muted">{l.product.sku}</p></td>
              <td className="td text-right text-lg font-medium">{l.quantity}</td>
              <td className="td">{l.quantity === 0 ? <Badge tone="red">Out of stock</Badge> : l.quantity <= LOW ? <Badge tone="amber">Low</Badge> : <Badge tone="green">Well stocked</Badge>}{!l.isActive && <span className="ml-2"><Badge>Hidden</Badge></span>}</td>
              <td className="td"><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" aria-label={`Adjust ${l.product.name}`} onClick={() => setAdj(l)}><SlidersHorizontal className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" aria-label={`History for ${l.product.name}`} onClick={() => setHist(l)}><History className="h-4 w-4" /></Button></div></td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
      <Adjust row={adj} onClose={() => setAdj(null)} onDone={reload} /><HistoryModal row={hist} onClose={() => setHist(null)} />
    </>
  );
}
