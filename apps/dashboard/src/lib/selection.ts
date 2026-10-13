import { useCallback, useEffect, useState } from "react";

export type View = "project" | "feature" | "insights" | "agents";
export type Panel = "preview" | "changes" | "checks" | "details";
export type AgentTab = "roles" | "skills" | "router";

export interface Selection {
  readonly project: string;
  readonly view: View;
  readonly feature: string | null;
  readonly session: string | null;
  readonly panel: Panel | null;
  readonly tab?: AgentTab | null;
  readonly item?: string | null;
}

const PANELS: readonly Panel[] = ["preview", "changes", "checks", "details"];
const TABS: readonly AgentTab[] = ["roles", "skills", "router"];
const PROJECT = /^[a-z][a-z0-9-]{1,30}$/;

function read(): Selection {
  const params = new URLSearchParams(location.search);
  const project = params.get("project") ?? "";
  const session = params.get("session");
  const feature = params.get("feature");
  const panel = params.get("panel") as Panel | null;
  const named = params.get("view");
  const view: View = named === "insights" || named === "agents" ? named : feature || session ? "feature" : "project";
  const tab = params.get("tab") as AgentTab | null;
  return {
    project: PROJECT.test(project) ? project : "",
    view,
    feature: view === "agents" ? null : feature,
    session: view === "agents" ? null : session,
    panel: view === "feature" && panel && PANELS.includes(panel) ? panel : null,
    tab: view === "agents" && tab && TABS.includes(tab) ? tab : null,
    item: view === "agents" ? params.get("item") : null,
  };
}

function write(selection: Selection) {
  const params = new URLSearchParams();
  if (selection.project) params.set("project", selection.project);
  if (selection.view === "insights") params.set("view", "insights");
  if (selection.view === "agents") {
    params.set("view", "agents");
    if (selection.tab) params.set("tab", selection.tab);
    if (selection.item) params.set("item", selection.item);
  }
  if (selection.view === "feature") {
    if (selection.feature) params.set("feature", selection.feature);
    if (selection.session) params.set("session", selection.session);
    if (selection.panel) params.set("panel", selection.panel);
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
