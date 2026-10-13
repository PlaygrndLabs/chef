import { useCallback, useEffect, useState } from "react";
import type { OverviewState, ProjectApi } from "./api";

const POLL_MS = 2500;
const seen = new Map<string, OverviewState>();

export function useOverview(api: Pick<ProjectApi, "overview" | "readCode">, key: string | null = null) {
  const [state, setState] = useState<OverviewState | null>(() => (key === null ? null : (seen.get(key) ?? null)));
  const keep = useCallback(
    (next: OverviewState) => {
      if (key !== null) seen.set(key, next);
      setState(next);
    },
    [key],
  );
  const load = useCallback(() => api.overview().then(keep, () => keep({ status: "none" })), [api, keep]);
  useEffect(() => {
    void load();
  }, [load]);
  const reading = state?.status === "reading";
  useEffect(() => {
    if (!reading) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [reading, load]);
  const readAgain = useCallback(() => api.readCode().then(keep), [api, keep]);
  return { state, readAgain };
}
