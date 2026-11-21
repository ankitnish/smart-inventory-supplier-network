"use client";
import dynamic from "next/dynamic";
import { Component, ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { Skeleton } from "../ui";

const Scene = dynamic(() => import("./WarehouseScene"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="grid h-full place-items-center rounded-2xl bg-[radial-gradient(circle_at_50%_40%,rgba(183,243,74,.15),transparent_60%)] text-sm text-muted">3D preview unavailable on this device</div> : this.props.children; }
}
const Panel = ({ className, label, value }: { className: string; label: string; value: string }) =>
  <div className={`absolute hidden rounded-lg border border-line bg-card/90 px-3 py-2 text-xs backdrop-blur sm:block ${className}`}><p className="text-muted">{label}</p><p className="font-semibold text-lime">{value}</p></div>;

export function Hero3D() {
  const reduce = useReducedMotion();
  return (
    <div className="relative h-[380px] w-full sm:h-[480px]">
      <Boundary><Scene animate={!reduce} /></Boundary>
      <Panel className="left-2 top-6" label="Stock level" value="Track" /><Panel className="right-2 top-24" label="Stockout risk" value="Predict" /><Panel className="bottom-10 left-6" label="Reorder" value="Recommend" /><Panel className="bottom-4 right-4" label="Purchase order" value="Order" />
      <p className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[11px] text-muted">Illustrative visualization</p>
    </div>
  );
}
