import type { Metadata } from "next";
import { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = { title: "Smart Inventory + Supplier Network", description: "Track, predict, recommend, order. Inventory, demand planning and supplier procurement in one platform.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
