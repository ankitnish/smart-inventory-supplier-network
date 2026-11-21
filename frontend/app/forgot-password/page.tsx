"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Input } from "@/components/ui";
import { AuthFrame } from "@/components/AuthForm";
import { api, toApiError } from "@/lib/api";

const schema = z.object({ email: z.string().email("Enter a valid email") });
export default function ForgotPage() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  return (
    <AuthFrame title="Reset your password" sub="We'll send a reset link if the email is registered." footer={<Link href="/login" className="text-lime hover:underline">Back to log in</Link>}>
      <form className="space-y-4" noValidate onSubmit={handleSubmit(async (v) => { setErr(null); try { setMsg((await api<{ message: string }>("/auth/forgot-password", { method: "POST", body: v })).message); } catch (e) { setErr(toApiError(e).message); } })}>
        {err && <Alert>{err}</Alert>}{msg && <Alert tone="green">{msg}</Alert>}
        <Input label="Email" type="email" error={errors.email?.message} {...register("email")} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Send reset link</Button>
        <p className="text-xs text-muted">Email delivery is not connected yet. In development the reset token is printed in the backend log (<code>docker compose logs backend</code>).</p>
      </form>
    </AuthFrame>
  );
}
