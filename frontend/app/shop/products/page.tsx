"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Search, Archive } from "lucide-react";
import { api, toApiError } from "@/lib/api";
import { useAsync, useDebounced } from "@/lib/hooks";
import { Category, Paged, ProductRow } from "@/lib/types";
import { money } from "@/lib/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pager, Select, Table, TableSkeleton, stockLabel, stockTone } from "@/components/ui";
import { applyServerErrors } from "@/components/AuthForm";

const priceRe = /^\d{1,10}(\.\d{1,2})?$/;
const intStr = z.string().regex(/^\d{1,7}$/, "Whole number, 0 or more");
const schema = z.object({
  sku: z.string().trim().min(2, "At least 2 characters").max(40), name: z.string().trim().min(2, "At least 2 characters").max(120), categoryId: z.string().min(1, "Choose a category"),
  unit: z.string().trim().min(1).max(20), costPrice: z.string().regex(priceRe, "e.g. 120 or 120.50"), sellingPrice: z.string().regex(priceRe, "e.g. 150 or 150.00"),
  quantity: intStr, minLevel: intStr, reorderPoint: intStr, perishable: z.boolean(), initialExpiryDate: z.string().optional(),
}).superRefine((v, c) => {
  if (priceRe.test(v.costPrice) && priceRe.test(v.sellingPrice) && Number(v.sellingPrice) < Number(v.costPrice)) c.addIssue({ code: "custom", path: ["sellingPrice"], message: "Selling price is below cost price" });
  if (v.perishable && Number(v.quantity) > 0 && !v.initialExpiryDate) c.addIssue({ code: "custom", path: ["initialExpiryDate"], message: "Expiry date required for perishable opening stock" });
});
type V = z.infer<typeof schema>;

function AddProduct({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const cats = useAsync(() => api<Category[]>("/products/categories"), []);
  const { register, handleSubmit, setError, watch, reset, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema),
    defaultValues: { unit: "unit", quantity: "0", minLevel: "0", reorderPoint: "0", perishable: false } });
  const [err, setErr] = useState<string | null>(null);
  const perishable = watch("perishable");
  const submit = async (v: V) => {
    setErr(null);
    try {
      await api("/products", { method: "POST", body: { ...v, sku: v.sku.trim(), quantity: Number(v.quantity), minLevel: Number(v.minLevel), reorderPoint: Number(v.reorderPoint), initialExpiryDate: v.perishable && v.initialExpiryDate ? v.initialExpiryDate : undefined } });
      reset(); onDone(); onClose();
    } catch (e) { setErr(applyServerErrors(toApiError(e), setError, ["sku", "name", "categoryId", "costPrice", "sellingPrice", "quantity", "initialExpiryDate"])); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add product" wide>
      <form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
        <Input label="SKU" error={errors.sku?.message} {...register("sku")} /><Input label="Name" error={errors.name?.message} {...register("name")} />
        <Select label="Category" error={errors.categoryId?.message} {...register("categoryId")}><option value="">Choose…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Input label="Unit" error={errors.unit?.message} {...register("unit")} />
        <Input label="Cost price" inputMode="decimal" error={errors.costPrice?.message} {...register("costPrice")} /><Input label="Selling price" inputMode="decimal" error={errors.sellingPrice?.message} {...register("sellingPrice")} />
        <Input label="Opening stock" inputMode="numeric" error={errors.quantity?.message} {...register("quantity")} /><Input label="Minimum level" inputMode="numeric" error={errors.minLevel?.message} {...register("minLevel")} />
        <Input label="Reorder point" inputMode="numeric" error={errors.reorderPoint?.message} {...register("reorderPoint")} />
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-lime" {...register("perishable")} />Perishable (tracks expiry dates)</label>
        {perishable && <Input label="Expiry date of opening stock" type="date" className="sm:col-span-2" error={errors.initialExpiryDate?.message} {...register("initialExpiryDate")} />}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Add product</Button></div>
      </form>
    </Modal>
  );
}

function Products() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? ""); const [sort, setSort] = useState("name"); const [page, setPage] = useState(1);
  const dq = useDebounced(q); const [adding, setAdding] = useState(false); const [archiving, setArchiving] = useState<ProductRow | null>(null); const [archErr, setArchErr] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api<Paged<ProductRow>>("/products", { query: { q: dq, sort, page, pageSize: 15 } }), [dq, sort, page]);
  const archive = async () => { if (!archiving) return; setArchErr(null); try { await api(`/products/${archiving.inventoryId}`, { method: "DELETE" }); setArchiving(null); reload(); } catch (e) { setArchErr(toApiError(e).message); } };
  return (
    <>
      <PageHeader title="Products" sub="Your catalog and current stock levels." actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add product</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3"><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
          <input aria-label="Search products" className="field pl-9" placeholder="Search name or SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <select aria-label="Sort by" className="field w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="name">Name</option><option value="quantity">Lowest stock</option><option value="updated">Recently updated</option></select></div>
        {loading ? <TableSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : !data?.items.length ? (
          <EmptyState title={dq ? "No products match your search" : "No products yet"} hint={dq ? "Try a different name or SKU." : "Add your first product to start tracking stock."} action={!dq ? <Button onClick={() => setAdding(true)}>Add product</Button> : undefined} />) : (
          <><Table><thead><tr className="border-b border-line"><th className="th">SKU</th><th className="th">Product</th><th className="th">Category</th><th className="th text-right">Cost</th><th className="th text-right">Price</th><th className="th text-right">Stock</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.items.map((p) => (<tr key={p.inventoryId} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td font-mono text-xs text-muted">{p.sku}</td>
              <td className="td font-medium">{p.name} {p.perishable && <Badge tone="amber">Perishable</Badge>}</td><td className="td text-muted">{p.category}</td><td className="td text-right">{money(p.costPrice)}</td><td className="td text-right">{money(p.sellingPrice)}</td>
              <td className="td text-right">{p.quantity}</td><td className="td"><Badge tone={stockTone(p.status)}>{stockLabel(p.status)}</Badge></td>
              <td className="td text-right"><Button variant="ghost" size="sm" aria-label={`Archive ${p.name}`} onClick={() => { setArchErr(null); setArchiving(p); }}><Archive className="h-4 w-4" /></Button></td></tr>))}</tbody></Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></>)}
      </Card>
      <AddProduct open={adding} onClose={() => setAdding(false)} onDone={reload} />
      <Modal open={!!archiving} onClose={() => setArchiving(null)} title="Archive product?">
        <p className="text-sm text-muted">{archiving?.name} will be hidden from your lists. Its sales and stock history are kept.</p>{archErr && <div className="mt-3"><Alert>{archErr}</Alert></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setArchiving(null)}>Cancel</Button><Button variant="danger" onClick={archive}>Archive</Button></div>
      </Modal>
    </>
  );
}
export default function ProductsPage() { return <Suspense><Products /></Suspense>; }
