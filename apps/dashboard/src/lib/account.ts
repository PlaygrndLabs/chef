import { useEffect, useState } from "react";
import { appApi, sharingApi, type AppMode, type OrgRole, type OrgSummary, type ProjectAccess, type ProjectLevel } from "@/lib/api";

let pending: Promise<AppMode> | null = null;

export function appMode(): Promise<AppMode> {
  return (pending ??= appApi.get());
}

export function useAppMode(): AppMode | null {
  const [mode, setMode] = useState<AppMode | null>(null);
  useEffect(() => {
    let live = true;
    void appMode().then((next) => live && setMode(next));
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

export const ROLE_NAME: Readonly<Record<OrgRole, string>> = { owner: "Owner", admin: "Admin", member: "Member" };

export const LEVEL_NAME: Readonly<Record<ProjectLevel, string>> = { view: "Can view", edit: "Can edit", manage: "Can manage" };

export function useProjectAccess(project: string): { readonly hosted: boolean; readonly access: ProjectAccess | null; readonly set: (next: ProjectAccess) => void } {
  const mode = useAppMode();
  const hosted = mode !== null && mode.account !== undefined;
  const [access, set] = useState<ProjectAccess | null>(null);
  useEffect(() => {
    if (!hosted) return;
    let live = true;
    set(null);
    sharingApi(project)
      .get()
      .then((next) => live && set(next), () => undefined);
    return () => {
      live = false;
    };
  }, [hosted, project]);
  return { hosted, access, set };
}
