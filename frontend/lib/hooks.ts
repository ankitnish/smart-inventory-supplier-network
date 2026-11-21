"use client";
import { DependencyList, useCallback, useEffect, useState } from "react";
import { ApiError, toApiError } from "./api";

/** Loads data and exposes loading / error / reload so every screen can show skeletons and retry. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    run().then((data) => !cancelled && setState({ data, loading: false })).catch((e) => !cancelled && setState({ loading: false, error: toApiError(e) }));
    return () => { cancelled = true; };
  }, [run, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
