import { appApi, projectsApi, type AppMode } from "./api";

export interface Boot {
  readonly mode: AppMode;
  readonly projects: readonly string[] | null;
}

let started: Promise<Boot> | null = null;

export function boot(): Promise<Boot> {
  started ??= Promise.all([
    appApi.get(),
    projectsApi.list().then(
      (list) => list.map((p) => p.name),
      () => null,
    ),
  ]).then(([mode, projects]) => ({ mode, projects }));
  return started;
}

export function hideSplash() {
  document.getElementById("splash")?.remove();
}
