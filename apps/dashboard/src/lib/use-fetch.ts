import { useEffect, useState } from "react";

export interface Fetched<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
}

export function useFetch<T>(load: (() => Promise<T>) | null, key: string): Fetched<T> {
  const [state, setState] = useState<Fetched<T>>({ data: null, error: null, loading: Boolean(load) });
  useEffect(() => {
    if (!load) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (error: unknown) => !cancelled && setState({ data: null, error: error instanceof Error ? error.message : String(error), loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}
