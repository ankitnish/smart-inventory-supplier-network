"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Search } from "lucide-react";
import { api, ApiError, toApiError } from "@/lib/api";
import { useAsync, useDebounced } from "@/lib/hooks";
import { AdminCategory, AdminProduct, Paged } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pager, Select, Table, TableSkeleton, cx } from "@/components/ui";
import { applyServerErrors } from "@/components/AuthForm";

const catSchema = z.object({ name: z.string().trim().min(2, "At least 2 characters").max(60) });
function CategoryModal({ open, editing, onClose, onDone }: { open: boolean; editing: AdminCategory | null; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<z.infer<typeof catSchema>>({ resolver: zodResolver(catSchema) });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { reset({ name: editing?.name ?? "" }); setErr(null); } }, [open, editing, reset]);
  return (
    <Modal open={open} onClose={onClose} title={editing ? "Rename category" : "Add category"}>
      <form noValidate className="space-y-4" onSubmit={handleSubmit(async (v) => { setErr(null); try { await api(editing ? `/admin/categories/${editing.id}` : "/admin/categories", { method: editing ? "PATCH" : "POST", body: v }); onDone(); onClose(); } catch (e) { setErr(applyServerErrors(toApiError(e), setError, ["name"])); } })}>
        {err && <Alert>{err}</Alert>}<Input label="Category name" error={errors.name?.message} {...register("name")} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>{editing ? "Save" : "Add category"}</Button></div>
      </form>
    </Modal>
  );
}

const prodSchema = z.object({ sku: z.string().trim().min(2, "At least 2 characters").max(40), name: z.string().trim().min(2, "At least 2 characters").max(120), categoryId: z.string().min(1, "Choose a category"),
  unit: z.string().trim().min(1).max(20), barcode: z.string().trim().max(40).optional(), perishable: z.boolean(), isActive: z.boolean() });
type PV = z.infer<typeof prodSchema>;
function ProductModal({ open, editing, cats, onClose, onDone }: { open: boolean; editing: AdminProduct | null; cats: AdminCategory[]; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, reset, setError, getValues, formState: { errors, isSubmitting } } = useForm<PV>({ resolver: zodResolver(prodSchema) });
  const [err, setErr] = useState<string | null>(null); const [needsForce, setNeedsForce] = useState(false);
  const locked = !!editing && (editing.shops > 0 || editing.listings > 0);
  useEffect(() => { if (open) { reset(editing ? { sku: editing.sku, name: editing.name, categoryId: editing.category.id, unit: editing.unit, barcode: editing.barcode ?? "", perishable: editing.perishable, isActive: editing.isActive } : { sku: "", name: "", categoryId: "", unit: "unit", barcode: "", perishable: false, isActive: true }); setErr(null); setNeedsForce(false); } }, [open, editing, reset]);
  const save = async (v: PV, force = false) => {
    setErr(null);
    try {
      if (editing) await api(`/admin/catalog/${editing.id}`, { method: "PATCH", body: { name: v.name, categoryId: v.categoryId, unit: v.unit, isActive: v.isActive, ...(locked ? {} : { perishable: v.perishable }), ...(force ? { force: true } : {}) } });
      else await api("/admin/catalog", { method: "POST", body: { sku: v.sku, name: v.name, categoryId: v.categoryId, unit: v.unit, barcode: v.barcode || undefined, perishable: v.perishable } });
      onDone(); onClose();
    } catch (e) { const a = toApiError(e) as ApiError; setNeedsForce(a.code === "LISTINGS_ACTIVE"); setErr(applyServerErrors(a, setError, ["sku", "name", "categoryId"])); }
  };
  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit product: ${editing.sku}` : "Add catalog product"} wide>
      <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save(v))}>
        {err && <div className="sm:col-span-2"><Alert>{err}</Alert>{needsForce && <Button type="button" variant="danger" size="sm" className="mt-2" onClick={() => save(getValues(), true)}>Deactivate anyway and hide those listings</Button>}</div>}
        <Input label="SKU" disabled={!!editing} error={errors.sku?.message} {...register("sku")} /><Input label="Name" error={errors.name?.message} {...register("name")} />
        <Select label="Category" error={errors.categoryId?.message} {...register("categoryId")}><option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Input label="Unit" error={errors.unit?.message} {...register("unit")} />
        {!editing && <Input label="Barcode (optional)" {...register("barcode")} />}
        <div className="space-y-2 self-end pb-1 text-sm">
          <label className={cx("flex items-center gap-2", locked && "opacity-60")}><input type="checkbox" disabled={locked} className="h-4 w-4 accent-lime" {...register("perishable")} />Perishable (tracks expiry dates)</label>
          {locked && <p className="text-xs text-muted">Locked: {editing!.shops} shop(s) stock it and {editing!.listings} supplier listing(s) use it.</p>}
          {editing && <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-lime" {...register("isActive")} />Active in the catalog</label>}</div>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>{editing ? "Save changes" : "Add product"}</Button></div>
      </form>
    </Modal>
  );
}

export default function CatalogPage() {
  const [tab, setTab] = useState<"products" | "categories">("products");
  const cats = useAsync(() => api<AdminCategory[]>("/admin/categories"), []);
  const [q, setQ] = useState(""); const dq = useDebounced(q); const [cat, setCat] = useState(""); const [page, setPage] = useState(1);
  const prods = useAsync(() => api<Paged<AdminProduct>>("/admin/catalog", { query: { q: dq, categoryId: cat, page, pageSize: 15 } }), [dq, cat, page]);
  const [addCat, setAddCat] = useState(false); const [editCat, setEditCat] = useState<AdminCategory | null>(null); const [addProd, setAddProd] = useState(false); const [editProd, setEditProd] = useState<AdminProduct | null>(null);
  const refresh = () => { cats.reload(); prods.reload(); };
  return (
    <>
      <PageHeader title="Catalog" sub="The shared product catalog every shop and supplier works from. Changes that would affect them are checked first."
        actions={tab === "products" ? <Button onClick={() => setAddProd(true)} disabled={!cats.data?.length}><Plus className="h-4 w-4" />Add product</Button> : <Button onClick={() => setAddCat(true)}><Plus className="h-4 w-4" />Add category</Button>} />
      <div className="mb-4 flex gap-1" role="tablist">{(["products", "categories"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("rounded-lg px-3 py-1.5 text-sm capitalize", tab === t ? "bg-lime/15 text-lime" : "text-muted hover:text-ink")}>{t}</button>)}</div>
      {tab === "categories" ? (
        <Card>{cats.loading ? <TableSkeleton rows={4} /> : cats.error ? <ErrorState error={cats.error} retry={cats.reload} /> : !cats.data?.length ? <EmptyState title="No categories yet" hint="Add a category before adding products." action={<Button onClick={() => setAddCat(true)}>Add category</Button>} /> : (
          <Table><thead><tr className="border-b border-line"><th className="th">Category</th><th className="th text-right">Products</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{cats.data.map((c) => <tr key={c.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td font-medium">{c.name}</td><td className="td text-right text-muted">{c.products}</td>
              <td className="td text-right"><Button variant="ghost" size="sm" aria-label={`Rename ${c.name}`} onClick={() => setEditCat(c)}><Pencil className="h-4 w-4" /></Button></td></tr>)}</tbody></Table>)}</Card>
      ) : (
        <Card>
          <div className="mb-4 flex flex-wrap gap-3"><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden /><input aria-label="Search catalog" className="field pl-9" placeholder="Search name or SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
            <select aria-label="Filter by category" className="field w-auto" value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }}><option value="">All categories</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          {prods.loading ? <TableSkeleton /> : prods.error ? <ErrorState error={prods.error} retry={prods.reload} /> : !prods.data?.items.length ? <EmptyState title={dq || cat ? "No products match" : "The catalog is empty"} /> : (
            <><Table><thead><tr className="border-b border-line"><th className="th">Product</th><th className="th">Category</th><th className="th text-right">Used by</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{prods.data.items.map((p) => <tr key={p.id} className="border-b border-line/60 last:border-0 hover:bg-white/[.02]"><td className="td"><p className="font-medium">{p.name} {p.perishable && <Badge tone="amber">Perishable</Badge>}</p><p className="font-mono text-xs text-muted">{p.sku}</p></td>
                <td className="td text-muted">{p.category.name}</td><td className="td text-right text-xs text-muted">{p.shops} shop(s)<br />{p.listings} listing(s)</td><td className="td"><Badge tone={p.isActive ? "green" : "gray"}>{p.isActive ? "Active" : "Inactive"}</Badge></td>
                <td className="td text-right"><Button variant="ghost" size="sm" aria-label={`Edit ${p.name}`} onClick={() => setEditProd(p)}><Pencil className="h-4 w-4" /></Button></td></tr>)}</tbody></Table>
              <Pager page={prods.data.page} pageSize={prods.data.pageSize} total={prods.data.total} onChange={setPage} /></>)}
        </Card>)}
      <CategoryModal open={addCat || !!editCat} editing={editCat} onClose={() => { setAddCat(false); setEditCat(null); }} onDone={refresh} />
      <ProductModal open={addProd || !!editProd} editing={editProd} cats={cats.data ?? []} onClose={() => { setAddProd(false); setEditProd(null); }} onDone={refresh} />
    </>
  );
}
