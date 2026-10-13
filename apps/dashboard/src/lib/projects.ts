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
  if (projects.includes(wanted)) return wanted;
  const last = lastProject();
  if (last && projects.includes(last)) return last;
  return projects[0] ?? null;
}
