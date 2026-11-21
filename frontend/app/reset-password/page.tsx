"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Input } from "@/components/ui";
import { AuthFrame } from "@/components/AuthForm";
import { api, toApiError } from "@/lib/api";

const schema = z.object({ token: z.string().length(64, "The reset token is 64 characters"), password: z.string().min(10, "At least 10 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a digit") });
function Form() {
  const params = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { token: params.get("token") ?? "" } });
  const [ok, setOk] = useState(false); const [err, setErr] = useState<string | null>(null);
  if (ok) return <AuthFrame title="Password updated" footer={<Link href="/login" className="text-lime hover:underline">Log in</Link>}><Alert tone="green">Your password was changed. You can log in now.</Alert></AuthFrame>;
  return (
    <AuthFrame title="Choose a new password" footer={<Link href="/login" className="text-lime hover:underline">Back to log in</Link>}>
      <form className="space-y-4" noValidate onSubmit={handleSubmit(async (v) => { setErr(null); try { await api("/auth/reset-password", { method: "POST", body: v }); setOk(true); } catch (e) { setErr(toApiError(e).message); } })}>
        {err && <Alert>{err}</Alert>}
        <Input label="Reset token" error={errors.token?.message} {...register("token")} />
        <Input label="New password" type="password" autoComplete="new-password" error={errors.password?.message} {...register("password")} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Update password</Button>
      </form>
    </AuthFrame>
  );
}
export default function ResetPage() { return <Suspense><Form /></Suspense>; }
