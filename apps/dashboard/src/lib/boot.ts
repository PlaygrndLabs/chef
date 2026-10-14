import { appMode } from "./account";
import { projectsApi, type UpdateOffer } from "./api";

export interface Boot {
  readonly projects: readonly string[] | null;
  readonly update: UpdateOffer | null;
}

let started: Promise<Boot> | null = null;

export function boot(): Promise<Boot> {
  started ??= Promise.all([
    appMode(),
    projectsApi.list().then(
      (list) => list.map((p) => p.name),
      () => null,
    ),
  ]).then(([mode, projects]) => ({ projects: mode.update?.running ? [] : projects, update: mode.update ?? null }));
  return started;
}

export function hideSplash() {
  document.getElementById("splash")?.remove();
}
