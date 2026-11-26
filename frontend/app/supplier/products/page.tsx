"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Search } from "lucide-react";
import { api, toApiError } from "@/lib/api";
import { useAsync, useDebounced } from "@/lib/hooks";
import { CatalogItem, Listing, Paged } from "@/lib/types";
import { money } from "@/lib/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pager, Table, TableSkeleton, cx } from "@/components/ui";
import { applyServerErrors } from "@/components/AuthForm";

const price = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "e.g. 120 or 120.50").refine((v) => Number(v) > 0, "Must be more than 0");
const whole = (min: number, label: string) => z.string().regex(/^\d{1,7}$/, "Whole number").refine((v) => Number(v) >= min, `${label} must be at least ${min}`);
const addSchema = z.object({ productId: z.string().min(1, "Choose a product"), unitPrice: price, quantity: whole(0, "Stock"), leadTimeDays: whole(0, "Lead time"), minOrderQty: whole(1, "Minimum order") });
const editSchema = z.object({ unitPrice: price, leadTimeDays: whole(0, "Lead time"), minOrderQty: whole(1, "Minimum order"), isActive: z.boolean() });
type AddV = z.infer<typeof addSchema>; type EditV = z.infer<typeof editSchema>;

function AddListing({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState(""); const dq = useDebounced(q, 250);
  const cat = useAsync(() => (open ? api<CatalogItem[]>("/supplier/catalog", { query: { q: dq } }) : Promise.resolve([] as CatalogItem[])), [dq, open]);
  const { register, handleSubmit, setValue, watch, setError, reset, formState: { errors, isSubmitting } } = useForm<AddV>({ resolver: zodResolver(addSchema), defaultValues: { quantity: "0", leadTimeDays: "3", minOrderQty: "1" } });
  const [err, setErr] = useState<string | null>(null); const chosen = watch("productId");
  useEffect(() => { if (!open) { reset(); setQ(""); setErr(null); } }, [open, reset]);
  const submit = async (v: AddV) => {
    setErr(null);
    try { await api("/supplier/products", { method: "POST", body: { productId: v.productId, unitPrice: v.unitPrice, quantity: Number(v.quantity), leadTimeDays: Number(v.leadTimeDays), minOrderQty: Number(v.minOrderQty) } }); onDone(); onClose(); }
    catch (e) { setErr(applyServerErrors(toApiError(e), setError, ["productId", "unitPrice", "quantity", "leadTimeDays", "minOrderQty"])); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a product listing" wide>
      <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <div><label htmlFor="cat-q" className="mb-1 block text-xs font-medium text-muted">Find a catalog product</label>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden /><input id="cat-q" className="field pl-9" placeholder="Search by name or SKU" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="Catalog products">
            {cat.loading ? <p className="p-3 text-sm text-muted">Loading…</p> : !cat.data?.length ? <p className="p-3 text-sm text-muted">No catalog products match.</p> : cat.data.map((p) => (
              <button type="button" key={p.id} role="option" aria-selected={chosen === p.id} onClick={() => setValue("productId", p.id, { shouldValidate: true })}
                className={cx("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5", chosen === p.id && "bg-lime/10 text-lime")}>
                <span>{p.name} <span className="font-mono text-xs text-muted">{p.sku}</span></span><span className="text-xs text-muted">{p.category.name}{p.perishable ? " · perishable" : ""}</span></button>))}</div>
          {errors.productId && <p className="mt-1 text-xs text-danger">{errors.productId.message}</p>}<input type="hidden" {...register("productId")} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Unit price" inputMode="decimal" error={errors.unitPrice?.message} {...register("unitPrice")} /><Input label="Stock available" inputMode="numeric" error={errors.quantity?.message} {...register("quantity")} />
          <Input label="Lead time (days)" inputMode="numeric" error={errors.leadTimeDays?.message} {...register("leadTimeDays")} /><Input label="Minimum order quantity" inputMode="numeric" error={errors.minOrderQty?.message} {...register("minOrderQty")} /></div>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Add listing</Button></div>
      </form>
    </Modal>
  );
}

function EditListing({ row, onClose, onDone }: { row: Listing | null; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<EditV>({ resolver: zodResolver(editSchema) });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (row) { reset({ unitPrice: String(row.unitPrice), leadTimeDays: String(row.leadTimeDays), minOrderQty: String(row.minOrderQty), isActive: row.isActive }); setErr(null); } }, [row, reset]);
  const submit = async (v: EditV) => {
    setErr(null);
    try { await api(`/supplier/products/${row!.id}`, { method: "PATCH", body: { unitPrice: v.unitPrice, leadTimeDays: Number(v.leadTimeDays), minOrderQty: Number(v.minOrderQty), isActive: v.isActive } }); onDone(); onClose(); }
    catch (e) { setErr(applyServerErrors(toApiError(e), setError, ["unitPrice", "leadTimeDays", "minOrderQty"])); }
  };
  return (
    <Modal open={!!row} onClose={onClose} title={`Edit listing: ${row?.product.name ?? ""}`}>
      <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2"><Input label="Unit price" inputMode="decimal" error={errors.unitPrice?.message} {...register("unitPrice")} />
          <Input label="Lead time (days)" inputMode="numeric" error={errors.leadTimeDays?.message} {...register("leadTimeDays")} />
          <Input label="Minimum order quantity" inputMode="numeric" error={errors.minOrderQty?.message} {...register("minOrderQty")} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-lime" {...register("isActive")} />Available to shops (untick to hide this listing)</label>
        <p className="text-xs text-muted">Stock quantity is changed on the Inventory page so every change is recorded.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Save changes</Button></div>
      </form>
    </Modal>
  );
}

export default function SupplierProductsPage() {
  const [q, setQ] = useState(""); const dq = useDebounced(q); const [page, setPage] = useState(1); const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<Listing | null>(null);
  const { data, error, loading, reload } = useAsync(() => api<Paged<Listing>>("/supplier/products", { query: { q: dq, page, pageSize: 15 } }), [dq, page]);
  return (
    <>
      <PageHeader title="Products" sub="The products you offer to shops, with your price and delivery time." actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add listing</Button>} />
      <Card>
        <div className="relative mb-4 max-w-sm"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden /><input aria-label="Search your listings" className="field pl-9" placeholder="Search name or SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? (
          <EmptyState title={dq ? "No listings match your search" : "No listings yet"} hint={dq ? undefined : "Add a listing from the shared catalog so shops can find and order it."} action={!dq ? <Button onClick={() => setAdding(true)}>Add listing</Button> : undefined} />) : (
          <><Table><thead><tr className="border-b border-line"><th className="th">Product</th><th className="th text-right">Price</th><th className="th text-right">Stock</th><th className="th text-right">Lead time</th><th className="th text-right">Min order</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.items.map((l) => <tr key={l.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td"><p className="font-medium">{l.product.name}</p><p className="font-mono text-xs text-muted">{l.product.sku}</p></td>
              <td className="td text-right">{money(l.unitPrice)}</td><td className="td text-right">{l.quantity}</td><td className="td text-right text-muted">{l.leadTimeDays} d</td><td className="td text-right text-muted">{l.minOrderQty}</td>
              <td className="td"><Badge tone={l.isActive ? "green" : "gray"}>{l.isActive ? "Active" : "Hidden"}</Badge></td>
              <td className="td text-right"><Button variant="ghost" size="sm" aria-label={`Edit ${l.product.name}`} onClick={() => setEditing(l)}><Pencil className="h-4 w-4" /></Button></td></tr>)}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
      <AddListing open={adding} onClose={() => setAdding(false)} onDone={reload} /><EditListing row={editing} onClose={() => setEditing(null)} onDone={reload} />
    </>
  );
}
