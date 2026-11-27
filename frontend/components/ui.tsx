"use client";
import { forwardRef, ReactNode, useEffect, useRef, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import { ApiError } from "@/lib/api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline"; loading?: boolean; size?: "sm" | "md" };
export function Button({ variant = "primary", loading, size = "md", className, children, disabled, ...p }: BtnProps) {
  const v = { primary: "bg-lime text-bg hover:bg-lime-dim font-semibold", ghost: "text-ink hover:bg-white/5", outline: "border border-line text-ink hover:border-lime/60", danger: "bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30" }[variant];
  return (
    <button {...p} disabled={disabled || loading} className={cx("inline-flex items-center justify-center gap-2 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm", v, className)}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cx("rounded-xl border border-line bg-card p-5", className)}>{children}</div>;

const tones = { green: "bg-emerald/15 text-emerald", lime: "bg-lime/15 text-lime", amber: "bg-amber/15 text-amber", red: "bg-danger/15 text-danger", gray: "bg-white/8 text-muted" };
export const Badge = ({ tone = "gray", children }: { tone?: keyof typeof tones; children: ReactNode }) => <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
export const stockTone = (s: string) => (s === "OK" ? "green" : s === "REORDER" ? "amber" : s === "LOW" ? "amber" : "red") as keyof typeof tones;
export const riskTone = (s: string) => (s === "LOW" ? "green" : s === "MEDIUM" ? "amber" : "red") as keyof typeof tones;
export const orderTone = { DRAFT: "gray", SUBMITTED: "amber", ACCEPTED: "lime", PROCESSING: "lime", SHIPPED: "lime", DELIVERED: "green", REJECTED: "red", CANCELLED: "gray" } as const;
export const accountTone = { PENDING: "amber", ACTIVE: "green", SUSPENDED: "red", REJECTED: "red" } as const;
export const prettyAction = (a: string) => a.replace(/[.-]/g, " ").replace(/^./, (c) => c.toUpperCase());
export const stockLabel = (s: string) => ({ OK: "In stock", REORDER: "Reorder soon", LOW: "Low", OUT_OF_STOCK: "Out of stock" })[s] ?? s;

export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cx("animate-pulse rounded-lg bg-white/5", className)} />;
export const TableSkeleton = ({ rows = 5 }: { rows?: number }) => <div className="space-y-2" role="status" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center gap-2 py-12 text-center"><Inbox className="h-8 w-8 text-muted" aria-hidden /><p className="font-medium">{title}</p>{hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}{action}</div>;
}
export function ErrorState({ error, retry }: { error: ApiError; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-10 text-center"><AlertTriangle className="h-8 w-8 text-danger" aria-hidden />
      <p className="font-medium">{error.status === 0 ? "Can't reach the server" : "Something went wrong"}</p><p className="max-w-md text-sm text-muted">{error.message}</p>
      {retry && <Button variant="outline" size="sm" onClick={retry}>Try again</Button>}</div>
  );
}
export const Alert = ({ tone = "red", children }: { tone?: "red" | "green" | "amber"; children: ReactNode }) =>
  <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-lg border px-3 py-2 text-sm", tone === "red" && "border-danger/30 bg-danger/10 text-danger", tone === "green" && "border-emerald/30 bg-emerald/10 text-emerald", tone === "amber" && "border-amber/30 bg-amber/10 text-amber")}>{children}</div>;

interface FieldProps { label: string; error?: string; hint?: string }
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input({ label, error, hint, className, id, ...p }, ref) {
  const i = id ?? `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return <div className={className}><label htmlFor={i} className="mb-1 block text-xs font-medium text-muted">{label}</label><input id={i} ref={ref} aria-invalid={!!error} className="field" {...p} />{hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}{error && <p className="mt-1 text-xs text-danger">{error}</p>}</div>;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(function Select({ label, error, className, id, children, ...p }, ref) {
  const i = id ?? `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return <div className={className}><label htmlFor={i} className="mb-1 block text-xs font-medium text-muted">{label}</label><select id={i} ref={ref} aria-invalid={!!error} className="field" {...p}>{children}</select>{error && <p className="mt-1 text-xs text-danger">{error}</p>}</div>;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function Textarea({ label, error, className, id, ...p }, ref) {
  const i = id ?? `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return <div className={className}><label htmlFor={i} className="mb-1 block text-xs font-medium text-muted">{label}</label><textarea id={i} ref={ref} className="field" rows={3} {...p} />{error && <p className="mt-1 text-xs text-danger">{error}</p>}</div>;
});

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey); ref.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
            className={cx("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card p-5 shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:text-ink"><X className="h-5 w-5" /></button></div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return <div className="mt-3 flex items-center justify-between text-sm text-muted"><span>Page {page} of {pages} · {total} total</span>
    <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</Button></div></div>;
}
export const PageHeader = ({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) =>
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}</div>{actions && <div className="flex gap-2">{actions}</div>}</div>;
export const Table = ({ children }: { children: ReactNode }) => <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse">{children}</table></div>;
