"use client";
import { useRouter } from "next/navigation";
import { Construction } from "lucide-react";
import { AuthGate } from "./AppShell";
import { Button } from "./ui";
import { useAuth } from "@/lib/auth";
import { Role } from "@/lib/types";

export function ComingSoon({ role, title }: { role: Role; title: string }) {
  const { logout } = useAuth(); const router = useRouter();
  return (
    <AuthGate role={role}><main className="grid min-h-screen place-items-center p-6"><div className="max-w-md text-center">
      <Construction className="mx-auto mb-3 h-10 w-10 text-lime" aria-hidden /><h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">This portal's API is ready, but its screens have not been built yet. They are planned for the next phase.</p>
      <Button variant="outline" className="mt-5" onClick={async () => { await logout(); router.replace("/login"); }}>Log out</Button></div></main></AuthGate>
  );
}
