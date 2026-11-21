"use client";
import { useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { api, newKey, toApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { InventoryRow, Paged, ProductRow, SaleRow } from "@/lib/types";
import { dateTime, fromCents, money, toCents } from "@/lib/format";
import { Alert, Button, Card, EmptyState, ErrorState, PageHeader, Pager, Select, Table, TableSkeleton } from "@/components/ui";

const line = z.object({ inventoryId: z.string().min(1, "Choose a product"), quantity: z.string().regex(/^[1-9]\d{0,4}$/, "Whole number ≥ 1"), unitPrice: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "e.g. 150 or 150.00") });
const schema = z.object({ items: z.array(line).min(1) }).refine((v) => new Set(v.items.map((i) => i.inventoryId)).size === v.items.length, { message: "Each product can appear once per sale", path: ["items"] });
type V = z.infer<typeof schema>;

export default function SalesPage() {
  const inv = useAsync(() => api<InventoryRow[]>("/inventory"), []);
  const prices = useAsync(() => api<Paged<ProductRow>>("/products", { query: { pageSize: 100 } }), []);
  const [page, setPage] = useState(1);
  const sales = useAsync(() => api<Paged<SaleRow>>("/sales", { query: { page, pageSize: 10 } }), [page]);
  const { register, control, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { items: [{ inventoryId: "", quantity: "1", unitPrice: "" }] } });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const key = useRef(newKey()); // one key per sale attempt: a retry after a network error cannot record the sale twice
  const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const items = watch("items");
  const priceOf = (id: string) => prices.data?.items.find((p) => p.inventoryId === id)?.sellingPrice ?? "";
  const totalCents = items.reduce((s, i) => { const q = Number(i.quantity), p = toCents(i.unitPrice ?? ""); return s + (Number.isInteger(q) && q > 0 && p !== null ? q * p : 0); }, 0);
  const sellable = inv.data?.filter((r) => r.available > 0 || r.perishable) ?? [];

  const submit = async (v: V) => {
    setErr(null); setDone(null);
    try {
      const r = await api<{ id: string; total: string; replayed: boolean }>("/sales", { method: "POST", headers: { "Idempotency-Key": key.current }, body: { items: v.items.map((i) => ({ inventoryId: i.inventoryId, quantity: Number(i.quantity), unitPrice: i.unitPrice })) } });
      setDone(`Sale recorded: ${money(r.total)}${r.replayed ? " (this was already recorded; nothing was duplicated)" : ""}`); key.current = newKey();
      reset({ items: [{ inventoryId: "", quantity: "1", unitPrice: "" }] }); inv.reload(); sales.reload(); setPage(1);
    } catch (e) { setErr(toApiError(e).message); }
  };
  return (
    <>
      <PageHeader title="Sales" sub="Record a sale; stock is reduced instantly and checked against what is available." />
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2"><h2 className="mb-4 font-medium">New sale</h2>
          {inv.loading ? <TableSkeleton rows={3} /> : inv.error ? <ErrorState error={inv.error} retry={inv.reload} /> : !inv.data?.length ? <EmptyState title="No products to sell" hint="Add products with stock first." /> : (
            <form onSubmit={handleSubmit(submit)} noValidate className="space-y-3">
              {err && <Alert>{err}</Alert>}{done && <Alert tone="green">{done}</Alert>}{errors.items?.message && <Alert>{errors.items.message}</Alert>}
              {fields.map((f, i) => { const av = inv.data!.find((r) => r.inventoryId === items[i]?.inventoryId);
                return (<div key={f.id} className="grid grid-cols-12 items-start gap-2 rounded-lg border border-line p-2">
                  <Select label="Product" className="col-span-12" error={errors.items?.[i]?.inventoryId?.message} {...register(`items.${i}.inventoryId`, { onChange: (e) => setValue(`items.${i}.unitPrice`, priceOf(e.target.value)) })}>
                    <option value="">Choose…</option>{sellable.map((r) => <option key={r.inventoryId} value={r.inventoryId}>{r.name} ({r.perishable ? r.sellableQuantity : r.available} available)</option>)}</Select>
                  <div className="col-span-5"><label className="mb-1 block text-xs font-medium text-muted" htmlFor={`q${i}`}>Qty</label><input id={`q${i}`} inputMode="numeric" className="field" {...register(`items.${i}.quantity`)} />{errors.items?.[i]?.quantity && <p className="mt-1 text-xs text-danger">{errors.items[i]!.quantity!.message}</p>}</div>
                  <div className="col-span-5"><label className="mb-1 block text-xs font-medium text-muted" htmlFor={`p${i}`}>Unit price</label><input id={`p${i}`} inputMode="decimal" className="field" {...register(`items.${i}.unitPrice`)} />{errors.items?.[i]?.unitPrice && <p className="mt-1 text-xs text-danger">{errors.items[i]!.unitPrice!.message}</p>}</div>
                  <div className="col-span-2 pt-6 text-right"><Button type="button" variant="ghost" size="sm" aria-label="Remove line" disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button></div>
                  {av && <p className="col-span-12 text-xs text-muted">{av.name}: {av.perishable ? av.sellableQuantity : av.available} available</p>}</div>); })}
              <Button type="button" variant="outline" size="sm" onClick={() => append({ inventoryId: "", quantity: "1", unitPrice: "" })}><Plus className="h-4 w-4" />Add line</Button>
              <div className="flex items-center justify-between border-t border-line pt-3"><span className="text-sm text-muted">Total</span><span className="text-xl font-semibold text-lime">{money(fromCents(totalCents))}</span></div>
              <Button type="submit" className="w-full" loading={isSubmitting}>Record sale</Button>
            </form>)}</Card>
        <Card className="xl:col-span-3"><h2 className="mb-4 font-medium">Recent sales</h2>
          {sales.loading ? <TableSkeleton /> : sales.error ? <ErrorState error={sales.error} retry={sales.reload} /> : !sales.data?.items.length ? <EmptyState title="No sales yet" hint="Recorded sales will be listed here." /> : (
            <><Table><thead><tr className="border-b border-line"><th className="th">When</th><th className="th">Items</th><th className="th text-right">Total</th></tr></thead>
              <tbody>{sales.data.items.map((s) => <tr key={s.id} className="border-b border-line/60 last:border-0 align-top"><td className="td text-muted">{dateTime(s.soldAt)}</td>
                <td className="td">{s.items.map((i) => <p key={i.id}>{i.quantity} × {i.inventory.product.name}</p>)}</td><td className="td text-right font-medium">{money(s.total)}</td></tr>)}</tbody></Table>
              <Pager page={sales.data.page} pageSize={sales.data.pageSize} total={sales.data.total} onChange={setPage} /></>)}</Card>
      </div>
    </>
  );
}
