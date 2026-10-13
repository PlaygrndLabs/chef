import { useCallback, useEffect, useState } from "react";

export type View = "project" | "feature" | "insights";
export type Panel = "preview" | "changes" | "checks" | "details";
export type SettingsScope = "app" | "project";

export interface SettingsPlace {
  readonly scope: SettingsScope;
  readonly section: string;
}

export interface Selection {
  readonly project: string;
  readonly view: View;
  readonly feature: string | null;
  readonly session: string | null;
  readonly panel: Panel | null;
  readonly settings?: SettingsPlace | null;
  readonly item?: string | null;
}

const PANELS: readonly Panel[] = ["preview", "changes", "checks", "details"];
const PROJECT = /^[a-z][a-z0-9-]{1,30}$/;
const SECTION = /^[a-z][a-z-]{1,30}$/;
const OLD_TABS: Readonly<Record<string, string>> = { roles: "agents", skills: "skills", router: "router" };

function readSettings(params: URLSearchParams): SettingsPlace | null {
  const [scope, section] = (params.get("settings") ?? "").split(".");
  if ((scope === "app" || scope === "project") && section && SECTION.test(section)) return { scope, section };
  if (params.get("view") === "agents") return { scope: "app", section: OLD_TABS[params.get("tab") ?? ""] ?? "agents" };
  return null;
}

function read(): Selection {
  const params = new URLSearchParams(location.search);
  const project = params.get("project") ?? "";
  const session = params.get("session");
  const feature = params.get("feature");
  const panel = params.get("panel") as Panel | null;
  const view: View = params.get("view") === "insights" ? "insights" : feature || session ? "feature" : "project";
  const settings = readSettings(params);
  return {
    project: PROJECT.test(project) ? project : "",
    view,
    feature,
    session,
    panel: view === "feature" && panel && PANELS.includes(panel) ? panel : null,
    settings,
    item: settings ? params.get("item") : null,
  };
}

function write(selection: Selection) {
  const params = new URLSearchParams();
  if (selection.project) params.set("project", selection.project);
  if (selection.view === "insights") params.set("view", "insights");
  if (selection.view === "feature") {
    if (selection.feature) params.set("feature", selection.feature);
    if (selection.session) params.set("session", selection.session);
    if (selection.panel) params.set("panel", selection.panel);
  }
  if (selection.settings) {
    params.set("settings", `${selection.settings.scope}.${selection.settings.section}`);
    if (selection.item) params.set("item", selection.item);
  }
  const next = `?${params.toString()}`;
  if (next !== location.search) history.pushState(null, "", next);
}

export function useSelection() {
  const [selection, setSelection] = useState<Selection>(read);
  useEffect(() => {
    const onPop = () => setSelection(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const select = useCallback((patch: Partial<Selection>) => {
    setSelection((current) => {
      const next = { ...current, ...patch };
      write(next);
      return next;
    });
  }, []);
  return [selection, select] as const;
}

export function isProjectName(name: string): boolean {
  return PROJECT.test(name);
}
