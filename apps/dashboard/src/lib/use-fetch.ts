import { useEffect, useState } from "react";

export interface Fetched<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
}

interface Held<T> {
  readonly scope: string;
  readonly key: string | null;
  readonly data: T | null;
  readonly error: string | null;
}

export function useFetch<T>(load: (() => Promise<T>) | null, key: string, scope: string = key): Fetched<T> {
  const [held, setHeld] = useState<Held<T>>({ scope, key: null, data: null, error: null });
  const enabled = load !== null;
  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    load().then(
      (data) => !cancelled && setHeld({ scope, key, data, error: null }),
      (error: unknown) => !cancelled && setHeld({ scope, key, data: null, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);
  if (!enabled) return { data: null, error: null, loading: false };
  const current = held.scope === scope;
  return { data: current ? held.data : null, error: current ? held.error : null, loading: held.key !== key };
}
