import { projectsApi } from "./api";

export interface Boot {
  readonly projects: readonly string[] | null;
}

let started: Promise<Boot> | null = null;

export function boot(): Promise<Boot> {
  started ??= projectsApi.list().then(
    (list) => ({ projects: list.map((p) => p.name) }),
    () => ({ projects: null }),
  );
  return started;
}

export function hideSplash() {
  document.getElementById("splash")?.remove();
}
