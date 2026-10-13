import { useCallback, useEffect, useState } from "react";
import type { OverviewState, ProjectApi } from "./api";

const POLL_MS = 2500;

export function useOverview(api: Pick<ProjectApi, "overview" | "readCode">) {
  const [state, setState] = useState<OverviewState | null>(null);
  const load = useCallback(() => api.overview().then(setState, () => setState({ status: "none" })), [api]);
  useEffect(() => {
    void load();
  }, [load]);
  const reading = state?.status === "reading";
  useEffect(() => {
    if (!reading) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [reading, load]);
  const readAgain = useCallback(() => api.readCode().then(setState), [api]);
  return { state, readAgain };
}
