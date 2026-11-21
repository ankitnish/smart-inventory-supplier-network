const currency = process.env.NEXT_PUBLIC_CURRENCY ?? "INR";
const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency });
export const money = (v: string | number | null | undefined) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : fmt.format(Number(v)));
export const num = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat().format(v));
export const dateTime = (v: string | Date) => new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const dateOnly = (v: string | Date) => new Date(v).toLocaleDateString(undefined, { dateStyle: "medium" });
/** Integer-cent helpers so on-screen totals never use float money maths. */
export const toCents = (v: string) => { const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim()); return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0) : null; };
export const fromCents = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
