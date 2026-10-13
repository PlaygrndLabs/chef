import { useCallback, useEffect, useState } from "react";
import { projectsApi } from "./api";

const LAST = "chef:project";

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
  } catch {
    return;
  }
}

export function useProjects() {
  const [projects, setProjects] = useState<readonly string[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const refresh = useCallback(() => {
    projectsApi.list().then(
      (list) => {
        setFailed(null);
        setProjects(list.map((p) => p.name));
      },
      (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  useEffect(refresh, [refresh]);
  return { projects, failed, refresh };
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
