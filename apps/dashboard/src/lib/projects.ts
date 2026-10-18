import { useCallback, useEffect, useMemo, useState } from "react";
import { addressWith } from "./address";
import { projectsApi, type ProjectEntry } from "./api";

const LAST = "chef:project";
const OPENED = "chef:opened";

export function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

export function rememberProject(name: string) {
  try {
    localStorage.setItem(LAST, name);
    localStorage.setItem(OPENED, JSON.stringify({ ...openedProjects(), [name]: Date.now() }));
  } catch {
    return;
  }
}

export function openedProjects(): Readonly<Record<string, number>> {
  try {
    const opened = JSON.parse(localStorage.getItem(OPENED) ?? "{}") as unknown;
    return opened && typeof opened === "object" ? (opened as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export interface RecentProject {
  readonly name: string;
  readonly at: number;
  readonly how: "updated" | "opened" | "created";
  readonly note: string | null;
}

export function recentProjects(entries: readonly ProjectEntry[], opened: Readonly<Record<string, number>>): RecentProject[] {
  return entries
    .map((entry): RecentProject => {
      const note = entry.note ?? null;
      const seen = opened[entry.name] ?? 0;
      const updated = entry.updatedAt ?? 0;
      if (updated >= seen && updated > 0) return { name: entry.name, at: updated, how: "updated", note };
      if (seen > 0) return { name: entry.name, at: seen, how: "opened", note };
      return { name: entry.name, at: entry.createdAt, how: "created", note };
    })
    .sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

export function returningToNewProject(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get("connect") !== "new") return false;
  params.delete("connect");
  history.replaceState(null, "", addressWith(params));
  return true;
}

export function useProjects(initial: readonly ProjectEntry[] | null = null) {
  const [entries, setEntries] = useState<readonly ProjectEntry[] | null>(initial);
  const [failed, setFailed] = useState<string | null>(null);
  const projects = useMemo(() => entries?.map((p) => p.name) ?? null, [entries]);
  const refresh = useCallback(() => {
    projectsApi.list().then(
      (list) => {
        setFailed(null);
        setEntries(list);
      },
      (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  const loaded = entries !== null;
  useEffect(() => {
    if (!loaded) refresh();
  }, [loaded, refresh]);
  return { projects, entries, failed, refresh };
}

export function pickProject(projects: readonly string[], wanted: string): string | null {
  return projects.includes(wanted) ? wanted : null;
}

export function projectNameFrom(repository: string): string {
  const base = (repository.split("/").at(-1) ?? repository)
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const named = /^[a-z]/.test(base) ? base : `app-${base}`;
  return named.slice(0, 31).replace(/-$/, "").padEnd(2, "x");
}
