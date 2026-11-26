import { ReactNode } from "react";
import { AppShell, AuthGate } from "@/components/AppShell";
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <AuthGate role="SHOP_OWNER"><AppShell role="SHOP_OWNER">{children}</AppShell></AuthGate>;
}
