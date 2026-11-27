import { ReactNode } from "react";
import { AppShell, AuthGate } from "@/components/AppShell";
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AuthGate role="ADMIN"><AppShell role="ADMIN">{children}</AppShell></AuthGate>;
}
