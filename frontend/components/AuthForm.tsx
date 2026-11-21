"use client";
import Link from "next/link";
import { ReactNode } from "react";
import { Boxes } from "lucide-react";
import { UseFormSetError, FieldValues, Path } from "react-hook-form";
import { ApiError } from "@/lib/api";

export function AuthFrame({ title, sub, children, footer }: { title: string; sub?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(60%_50%_at_50%_0%,rgba(183,243,74,.08),transparent)] p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-lime text-bg"><Boxes className="h-5 w-5" /></span>Smart Inventory</Link>
        <div className="rounded-2xl border border-line bg-card p-6 shadow-2xl"><h1 className="text-xl font-semibold">{title}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}<div className="mt-5">{children}</div></div>
        {footer && <p className="mt-4 text-center text-sm text-muted">{footer}</p>}
      </div>
    </main>
  );
}
/** Puts server-side validation messages next to the matching form fields. Returns the leftover general message. */
export function applyServerErrors<T extends FieldValues>(e: ApiError, setError: UseFormSetError<T>, known: string[]): string | null {
  let general: string | null = e.details?.length ? null : e.message;
  for (const d of e.details ?? []) { if (known.includes(d.path)) setError(d.path as Path<T>, { message: d.message }); else general = `${d.path}: ${d.message}`; }
  return general;
}
