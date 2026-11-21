"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { api, toApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { Recommendation } from "@/lib/types";
import { dateOnly, dateTime, money } from "@/lib/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, cx, riskTone } from "@/components/ui";

const statusTone = { PENDING: "gray", ADJUSTED: "amber", CONFIRMED: "lime", ORDERED: "green", DISMISSED: "gray" } as const;
interface GenResult { generated: unknown[]; skipped: { inventoryId: string; name: string; reason: string }[] }

function Detail({ r }: { r: Recommendation }) {
  const a = r.assumptions; const i = a.inputs;
  const rows: [string, string][] = [
    ["On hand", String(i.onHand)], ["Counted as available", String(i.effectiveAvailable)], ["Already on order", String(i.incomingQuantity)],
    ["Expected daily demand", `${i.dailyDemand} (±${i.dailyDemandStd})`], ["Lead time used", `${i.leadTimeDays} days`], ["Planning period", `${i.leadTimeDays} lead + ${i.reviewPeriodDays} review days`],
    ["Safety stock", String(a.reorder.safetyStock)], ["Demand over period", String(a.reorder.demandOverHorizon)], ["Days of stock left", a.stockout.daysRemaining == null ? "no demand" : String(a.stockout.daysRemaining)],
    ["Forecast method", a.forecast.method.replace(/_/g, " ")], ["Sales history used", `${i.historyDaysUsed} days`], ["Model version", a.methodVersion], ["Generated", dateTime(a.generatedAt)],
  ];
  return (
    <div className="mt-3 rounded-lg border border-line bg-bg2 p-4 text-sm">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl>
      {a.forecast.fallbackReason && <div className="mt-3"><Alert tone="amber">{a.forecast.fallbackReason}</Alert></div>}
      {a.perishable && <p className="mt-3 text-muted">Perishable stock: {a.perishable.sellableQuantity} sellable, {a.perishable.expiredQuantity} expired, <b className="text-ink">{a.perishable.projectedWaste} projected to expire unsold</b> (not counted as available).</p>}
      {!!a.forecast.validation.length && <div className="mt-3"><p className="mb-1 text-muted">Back-test error on your own history (lower is better)</p>
        <table className="w-full text-xs"><thead><tr className="text-muted"><th className="py-1 text-left">Method</th><th className="text-right">MAE</th><th className="text-right">RMSE</th></tr></thead>
          <tbody>{a.forecast.validation.map((v) => <tr key={v.method}><td className="py-0.5">{v.method.replace(/_/g, " ")}{v.method === a.forecast.method && " ✓"}</td><td className="text-right">{v.mae?.toFixed(2) ?? "n/a"}</td><td className="text-right">{v.rmse?.toFixed(2) ?? "n/a"}</td></tr>)}</tbody></table></div>}
      <p className="mt-3 text-xs text-muted">These are statistical baselines, not guarantees. Review them before ordering.</p>
    </div>
  );
}

function RecCard({ r, onChanged }: { r: Recommendation; onChanged: (msg?: string) => void }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [qty, setQty] = useState(String(r.adjustedQty ?? r.recommendedQty));
  const run = async (fn: () => Promise<string | void>) => { setBusy(true); setErr(null); try { onChanged(await fn() || undefined); } catch (e) { setErr(toApiError(e).message); } finally { setBusy(false); } };
  const effective = r.adjustedQty ?? r.recommendedQty; const s = r.assumptions.supplier; const live = r.status === "PENDING" || r.status === "ADJUSTED" || r.status === "CONFIRMED";
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-semibold">{r.product?.name ?? "Product"}</h3><p className="font-mono text-xs text-muted">{r.product?.sku}</p></div>
        <div className="flex gap-2"><Badge tone={riskTone(r.risk)}>{r.risk.toLowerCase()} risk</Badge><Badge tone={statusTone[r.status]}>{r.status.toLowerCase()}</Badge></div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div><p className="text-xs uppercase tracking-wide text-muted">Order quantity</p><p className="text-3xl font-semibold text-lime">{effective}</p>{r.adjustedQty != null && <p className="text-xs text-muted">suggested {r.recommendedQty}</p>}</div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Order by</p><p className="font-medium">{dateOnly(r.assumptions.suggestedOrderDate)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Suggested supplier</p>{s ? <><p className="font-medium">{r.supplier?.name ?? s.name}</p><p className="text-xs text-muted">{money(s.unitPrice)} each · {s.leadTimeDays}-day lead · min {s.minOrderQty}</p></> : <p className="text-sm text-amber">None available</p>}</div>
      </div>
      <p className="mt-4 text-sm text-muted">{r.explanation}</p>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-3 inline-flex items-center gap-1 text-sm text-lime hover:underline"><ChevronDown className={cx("h-4 w-4 transition", open && "rotate-180")} />Why this number?</button>
      {open && <Detail r={r} />}
      {err && <div className="mt-3"><Alert>{err}</Alert></div>}
      {live && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <div><label htmlFor={`q-${r.id}`} className="mb-1 block text-xs text-muted">Adjust quantity</label>
            <div className="flex gap-2"><input id={`q-${r.id}`} inputMode="numeric" className="field w-24" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Button variant="outline" size="sm" disabled={busy || !/^[1-9]\d{0,6}$/.test(qty) || Number(qty) === effective} onClick={() => run(async () => { await api(`/recommendations/${r.id}`, { method: "PATCH", body: { adjustedQty: Number(qty) } }); })}>Save</Button></div></div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/recommendations/${r.id}/dismiss`, { method: "POST" }); })}>Dismiss</Button>
            {r.status !== "CONFIRMED" ? <Button size="sm" loading={busy} onClick={() => run(async () => { await api(`/recommendations/${r.id}/confirm`, { method: "POST" }); })}>Confirm</Button>
              : <Button size="sm" loading={busy} disabled={!r.supplier} onClick={() => run(async () => { const o = await api<{ number: string }>(`/recommendations/${r.id}/create-order`, { method: "POST" }); return `Draft order ${o.number} created. Review and submit it under Purchase orders.`; })}>Create draft order</Button>}
          </div></div>)}
      {r.status === "ORDERED" && <p className="mt-4 border-t border-line pt-3 text-sm text-muted">A draft order was created. <Link href="/shop/purchase-orders" className="text-lime hover:underline">View purchase orders</Link></p>}
    </Card>
  );
}

export default function RecommendationsPage() {
  const { data, error, loading, reload } = useAsync(() => api<Recommendation[]>("/recommendations"), []);
  const [tab, setTab] = useState<"open" | "history">("open"); const [gen, setGen] = useState(false); const [genErr, setGenErr] = useState<string | null>(null);
  const [result, setResult] = useState<GenResult | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const generate = async () => { setGen(true); setGenErr(null); setNotice(null); try { setResult(await api<GenResult>("/recommendations/generate", { method: "POST", body: {} })); reload(); } catch (e) { setGenErr(toApiError(e).message); } finally { setGen(false); } };
  const shown = (data ?? []).filter((r) => (tab === "open" ? r.status === "PENDING" || r.status === "ADJUSTED" || r.status === "CONFIRMED" : r.status === "ORDERED" || r.status === "DISMISSED"));
  return (
    <>
      <PageHeader title="Recommendations" sub="Calculated from your sales history, stock, incoming orders and supplier lead times. Nothing is ordered until you confirm." actions={<Button onClick={generate} loading={gen}><Sparkles className="h-4 w-4" />Generate recommendations</Button>} />
      {genErr && <div className="mb-4"><Alert>{genErr}</Alert></div>}{notice && <div className="mb-4"><Alert tone="green">{notice}</Alert></div>}
      {result && <div className="mb-4"><Alert tone={result.generated.length ? "green" : "amber"}>{result.generated.length} recommendation{result.generated.length === 1 ? "" : "s"} generated. {result.skipped.length > 0 && `${result.skipped.length} product${result.skipped.length === 1 ? "" : "s"} skipped: ${result.skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join("; ")}${result.skipped.length > 3 ? "…" : ""}`}</Alert></div>}
      <div className="mb-4 flex gap-1" role="tablist">{(["open", "history"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("rounded-lg px-3 py-1.5 text-sm", tab === t ? "bg-lime/15 text-lime" : "text-muted hover:text-ink")}>{t === "open" ? "To review" : "History"}</button>)}</div>
      {loading ? <div className="space-y-4"><Skeleton className="h-48" /><Skeleton className="h-48" /></div> : error ? <Card><ErrorState error={error} retry={reload} /></Card> : !shown.length ? (
        <Card><EmptyState title={tab === "open" ? "Nothing to review" : "No history yet"} hint={tab === "open" ? "Generate recommendations to see which products need restocking." : undefined} /></Card>) :
        <div className="space-y-4">{shown.map((r) => <RecCard key={r.id} r={r} onChanged={(m) => { if (m) setNotice(m); reload(); }} />)}</div>}
    </>
  );
}
