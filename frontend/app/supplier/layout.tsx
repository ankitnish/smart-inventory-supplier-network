import { ReactNode } from "react";
import { AppShell, AuthGate } from "@/components/AppShell";
export default function SupplierLayout({ children }: { children: ReactNode }) {
  return <AuthGate role="SUPPLIER"><AppShell role="SUPPLIER">{children}</AppShell></AuthGate>;
}
