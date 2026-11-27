"use client";
import { useState } from "react";
import { api, toApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { AccountStatus, AdminUserDetail } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, ErrorState, Modal, TableSkeleton, Textarea, accountTone, prettyAction } from "../ui";

type Decision = { to: Exclude<AccountStatus, "PENDING">; label: string; variant: "primary" | "danger"; reasonRequired: boolean; prompt: string };
const decisionsFor = (s: AccountStatus): Decision[] => s === "PENDING" ? [
    { to: "REJECTED", label: "Reject", variant: "danger", reasonRequired: true, prompt: "Reason for rejecting (the applicant will see this)" },
    { to: "ACTIVE", label: "Approve", variant: "primary", reasonRequired: false, prompt: "Note for the record (optional)" }]
  : s === "ACTIVE" ? [{ to: "SUSPENDED", label: "Suspend", variant: "danger", reasonRequired: true, prompt: "Reason for suspending (the user will see this)" }]
  : [{ to: "ACTIVE", label: s === "REJECTED" ? "Approve after review" : "Reactivate", variant: "primary", reasonRequired: false, prompt: "Note for the record (optional)" }];
const roleLabel = { SHOP_OWNER: "Shop owner", SUPPLIER: "Supplier", ADMIN: "Administrator" } as const;

export function UserModal({ userId, onClose, onChanged }: { userId: string | null; onClose: () => void; onChanged: () => void }) {
  const { data: u, error, loading, reload } = useAsync(() => (userId ? api<AdminUserDetail>(`/admin/users/${userId}`) : Promise.resolve(null)), [userId]);
  const [decision, setDecision] = useState<Decision | null>(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const close = () => { setDecision(null); setReason(""); setErr(null); setOk(null); onClose(); };
  const submit = async () => {
    if (!decision || !u) return; setBusy(true); setErr(null); setOk(null);
    try { await api(`/admin/users/${u.id}/status`, { method: "POST", body: { status: decision.to, reason: reason.trim() || undefined } }); setOk(`${u.name} is now ${decision.to.toLowerCase()}.`); setDecision(null); setReason(""); reload(); onChanged(); }
    catch (e) { setErr(toApiError(e).message); } finally { setBusy(false); }
  };
  const decisions = u && u.role !== "ADMIN" ? decisionsFor(u.status) : [];
  return (
    <Modal open={!!userId} onClose={close} title={u ? u.name : "Account"} wide>
      {loading ? <TableSkeleton rows={4} /> : error ? <ErrorState error={error} retry={reload} /> : u && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={accountTone[u.status]}>{u.status.toLowerCase()}</Badge><Badge>{roleLabel[u.role]}</Badge><span className="text-sm text-muted">{u.email}</span></div>
          {err && <Alert>{err}</Alert>}{ok && <Alert tone="green">{ok}</Alert>}
          <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-bg2 p-4 text-sm sm:grid-cols-2">
            {([["Business name", u.business?.name ?? "—"], ["Address", u.business?.address ?? "not provided"], ["Registered", dateTime(u.createdAt)], ["Orders", String(u.orders)], ["Last decision note", u.business?.note ?? "none yet"]] as const).map(([k, v]) =>
              <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl>
          <div className="text-sm"><p className="mb-1 font-medium">Recent activity</p>
            {!u.history.length ? <p className="text-muted">Nothing recorded yet.</p> : <ul className="space-y-1 text-muted">{u.history.map((h) => <li key={h.id}>{dateTime(h.createdAt)} · {prettyAction(h.action)} · by {h.actor}</li>)}</ul>}</div>
          {decision && <div className="space-y-3 rounded-lg border border-line p-3"><Textarea label={decision.prompt} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => { setDecision(null); setErr(null); }}>Back</Button>
              <Button variant={decision.variant} size="sm" loading={busy} disabled={decision.reasonRequired && reason.trim().length < 3} onClick={submit}>Confirm: {decision.label.toLowerCase()}</Button></div></div>}
          {!decision && decisions.length > 0 && <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">{decisions.map((d) => <Button key={d.to} variant={d.variant} onClick={() => { setErr(null); setOk(null); setDecision(d); }}>{d.label}</Button>)}</div>}
          {u.role === "ADMIN" && <p className="text-xs text-muted">Administrator accounts cannot be changed from this screen.</p>}
        </div>)}
    </Modal>
  );
}
