"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Input } from "@/components/ui";
import { AuthFrame, applyServerErrors } from "@/components/AuthForm";
import { homeFor, useAuth } from "@/lib/auth";
import { toApiError } from "@/lib/api";

const schema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });
type V = z.infer<typeof schema>;

function LoginForm() {
  const { login } = useAuth(); const router = useRouter(); const next = useSearchParams().get("next");
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema) });
  const [err, setErr] = useState<string | null>(null);
  const onSubmit = async (v: V) => {
    setErr(null);
    try { const u = await login(v.email, v.password); router.replace(next && next.startsWith("/") ? next : homeFor(u.role)); }
    catch (e) { setErr(applyServerErrors(toApiError(e), setError, ["email", "password"])); }
  };
  return (
    <AuthFrame title="Welcome back" sub="Log in to your inventory workspace." footer={<>New here? <Link href="/register" className="text-lime hover:underline">Create an account</Link></>}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {err && <Alert>{err}</Alert>}
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <Input label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register("password")} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Log in</Button>
        <p className="text-center text-sm"><Link href="/forgot-password" className="text-muted hover:text-ink">Forgot your password?</Link></p>
      </form>
    </AuthFrame>
  );
}
export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
