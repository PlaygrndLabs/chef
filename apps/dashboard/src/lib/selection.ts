import { useCallback, useEffect, useState } from "react";

export type View = "project" | "feature" | "session" | "insights";
export type Tab = "preview" | "changes" | "artifacts" | "sandbox" | "budget";

export interface Selection {
  readonly project: string;
  readonly view: View;
  readonly feature: string | null;
  readonly session: string | null;
  readonly tab: Tab;
}

const TABS: readonly Tab[] = ["preview", "changes", "artifacts", "sandbox", "budget"];
const PROJECT = /^[a-z][a-z0-9-]{1,30}$/;

function read(): Selection {
  const params = new URLSearchParams(location.search);
  const project = params.get("project") ?? "";
  const session = params.get("session");
  const feature = params.get("feature");
  const tab = params.get("tab") as Tab | null;
  const view: View = params.get("view") === "insights" ? "insights" : session ? "session" : feature ? "feature" : "project";
  return { project: PROJECT.test(project) ? project : "demo", view, feature, session, tab: tab && TABS.includes(tab) ? tab : "preview" };
}

function write(selection: Selection) {
  const params = new URLSearchParams();
  params.set("project", selection.project);
  if (selection.view === "insights") params.set("view", "insights");
  if (selection.feature && (selection.view === "feature" || selection.view === "session")) params.set("feature", selection.feature);
  if (selection.session && selection.view === "session") params.set("session", selection.session);
  if (selection.tab !== "preview") params.set("tab", selection.tab);
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
