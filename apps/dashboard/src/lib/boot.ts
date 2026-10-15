import { host } from "@/host";
import { projectsApi, type ProjectEntry } from "./api";

export interface Boot {
  readonly projects: readonly ProjectEntry[] | null;
  readonly locked: boolean;
}

let started: Promise<Boot> | null = null;

export function boot(): Promise<Boot> {
  started ??= Promise.all([
    host.start ? host.start() : Promise.resolve({ locked: false }),
    projectsApi.list().catch(() => null),
  ]).then(([start, projects]) => ({ projects: start.locked ? [] : projects, locked: start.locked }));
  return started;
}

export function hideSplash() {
  document.getElementById("splash")?.remove();
}
