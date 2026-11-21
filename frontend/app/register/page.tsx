"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Input, cx } from "@/components/ui";
import { AuthFrame, applyServerErrors } from "@/components/AuthForm";
import { api, toApiError } from "@/lib/api";

const schema = z.object({
  accountType: z.enum(["SHOP_OWNER", "SUPPLIER"]), name: z.string().trim().min(2, "At least 2 characters"), businessName: z.string().trim().min(2, "At least 2 characters"),
  address: z.string().trim().max(200).optional(), email: z.string().email("Enter a valid email"),
  password: z.string().min(10, "At least 10 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a digit"),
});
type V = z.infer<typeof schema>;

export default function RegisterPage() {
  const { register, handleSubmit, setError, watch, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { accountType: "SHOP_OWNER" } });
  const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState(false);
  const type = watch("accountType");
  const onSubmit = async (v: V) => {
    setErr(null);
    try { await api("/auth/register", { method: "POST", body: { ...v, address: v.address || undefined } }); setDone(true); }
    catch (e) { setErr(applyServerErrors(toApiError(e), setError, ["email", "password", "name", "businessName", "address"])); }
  };
  if (done) return (
    <AuthFrame title="Account created" footer={<Link href="/login" className="text-lime hover:underline">Go to log in</Link>}>
      <Alert tone="green">Your account is awaiting admin verification. You can log in now; selling and ordering unlock once it is approved.</Alert></AuthFrame>);
  return (
    <AuthFrame title="Create your account" sub="Choose how you will use the platform." footer={<>Already registered? <Link href="/login" className="text-lime hover:underline">Log in</Link></>}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {err && <Alert>{err}</Alert>}
        <fieldset className="grid grid-cols-2 gap-2"><legend className="sr-only">Account type</legend>
          {([["SHOP_OWNER", "Shop owner"], ["SUPPLIER", "Supplier"]] as const).map(([v, l]) => (
            <label key={v} className={cx("cursor-pointer rounded-lg border px-3 py-2 text-center text-sm transition", type === v ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-ink")}>
              <input type="radio" value={v} className="sr-only" {...register("accountType")} />{l}</label>))}</fieldset>
        <Input label="Your name" autoComplete="name" error={errors.name?.message} {...register("name")} />
        <Input label={type === "SHOP_OWNER" ? "Shop name" : "Company name"} error={errors.businessName?.message} {...register("businessName")} />
        <Input label="Address (optional)" autoComplete="street-address" error={errors.address?.message} {...register("address")} />
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <Input label="Password" type="password" autoComplete="new-password" hint="10+ characters with a letter and a digit" error={errors.password?.message} {...register("password")} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
    </AuthFrame>
  );
}
