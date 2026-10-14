import { useEffect, useState } from "react";
import { appApi, type AppMode, type OrgSummary } from "@/lib/api";

let pending: Promise<AppMode> | null = null;

export function useAppMode(): AppMode | null {
  const [mode, setMode] = useState<AppMode | null>(null);
  useEffect(() => {
    let live = true;
    void (pending ??= appApi.get()).then((next) => live && setMode(next));
    return () => {
      live = false;
    };
  }, []);
  return mode;
}

export const PLAN_LABEL: Readonly<Record<OrgSummary["plan"], string>> = { free: "Free" };

export function orgLabel(org: Pick<OrgSummary, "name" | "personal">): string {
  return org.personal ? "Personal" : org.name;
}
