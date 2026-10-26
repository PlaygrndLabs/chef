export const APP_START_SECONDS = 600;

export type AppStatus = "starting" | "running" | "failed" | "no-stack";

export interface AppRun {
  readonly status: Exclude<AppStatus, "starting">;
  readonly url: string | null;
  readonly local: string | null;
  readonly commitId: string;
  readonly error?: string;
  readonly via?: "worker";
}

export interface AppHost {
  run(input: { readonly target: string; readonly repo: string; readonly ref: string; readonly commitId: string; readonly onWorkers?: boolean }): Promise<AppRun>;
}
