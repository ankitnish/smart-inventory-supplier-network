import { ReactNode } from "react";
import { AppShell, AuthGate } from "@/components/AppShell";
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <AuthGate role="SHOP_OWNER"><AppShell>{children}</AppShell></AuthGate>;
}
