import type { Budget, FeatureSpec, OutboundMode, SessionChanges, SessionRecord, SessionTurn, SubmitResult, SyncState } from "@chef/core";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `${response.status} ${response.statusText}`, response.status);
  }
  return (await response.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export interface SandboxStatus {
  readonly running: boolean;
  readonly exit: string | null;
}

export type Source = "app" | "deployment";

export interface ProviderView {
  readonly kind: string;
  readonly baseUrl: string | null;
  readonly keyHint: string;
  readonly source: Source;
}

export interface SettingsView {
  readonly llm: ProviderView | null;
  readonly voice: ProviderView | null;
  readonly jev: { readonly keyHint: string; readonly source: Source } | null;
  readonly cloudflare: { readonly accountId: string; readonly keyHint: string; readonly source: Source } | null;
  readonly models: { readonly planner: string; readonly reviewer: string; readonly coder: string; readonly source: Source };
  readonly attempts: { readonly value: number; readonly source: Source };
  readonly password: Source;
}

export type SettingsUpdate = Readonly<Record<string, unknown>>;

export const settingsApi = {
  get: () => call<SettingsView>("/api/settings"),
  save: (update: SettingsUpdate) => call<SettingsView>("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
};

export interface ProjectEntry {
  readonly name: string;
  readonly createdAt: number;
}

export interface NewProject {
  readonly name: string;
  readonly git?: GitLinkUpdate;
}

export interface Suggestion {
  readonly title: string;
  readonly why: string;
  readonly prompt: string;
}

export interface Overview {
  readonly summary: string;
  readonly problems: readonly string[];
  readonly suggestions: readonly Suggestion[];
}

export type OverviewState =
  | { readonly status: "none" }
  | { readonly status: "reading"; readonly since: number }
  | { readonly status: "ready"; readonly commitId: string | null; readonly at: number; readonly overview: Overview }
  | { readonly status: "failed"; readonly at: number; readonly error: string };

export const projectsApi = {
  list: () => call<{ projects: ProjectEntry[] }>("/api/projects").then((r) => r.projects),
  create: (project: NewProject) => call<{ name: string; created: boolean; imported?: boolean }>("/api/projects", post(project)),
};

export interface GitHubAppView {
  readonly slug: string;
  readonly name: string;
  readonly owner: string;
  readonly htmlUrl: string;
  readonly installUrl: string;
}

export interface InstalledRepository {
  readonly fullName: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly private: boolean;
}

export interface GitHubView {
  readonly app: GitHubAppView | null;
  readonly repositories: readonly InstalledRepository[];
  readonly error?: string;
}

export const githubApi = {
  get: () => call<GitHubView>("/api/github"),
  forget: () => call<GitHubView>("/api/github", { method: "DELETE" }),
  connectUrl: (returnTo: string, organization?: string) => `/api/github/connect?${new URLSearchParams({ returnTo, ...(organization ? { organization } : {}) }).toString()}`,
};

export interface GitLinkView {
  readonly url: string;
  readonly branch: string;
  readonly tokenHint: string | null;
  readonly mode: OutboundMode;
  readonly syncBranch: string;
  readonly webhookSecret: string;
  readonly pullRequests: boolean;
  readonly github: boolean;
}

export interface ProjectSettingsView {
  readonly previewIdleMinutes: number;
  readonly git: GitLinkView | null;
}

export interface GitLinkUpdate {
  readonly url: string;
  readonly branch: string;
  readonly token?: string;
  readonly github?: boolean;
  readonly mode: OutboundMode;
  readonly syncBranch: string;
}

export interface ProjectSettingsUpdate {
  readonly previewIdleMinutes?: number | null;
  readonly git?: GitLinkUpdate | null;
}

export function projectApi(project: string) {
  const base = `/api/projects/${project}`;
  return {
    spec: () => call<{ commitId: string | null; features: FeatureSpec[] }>(`${base}/spec`),
    sessions: () => call<SessionRecord[]>(`${base}/sessions`),
    session: (id: string) => call<{ record: SessionRecord; budget: Budget }>(`${base}/sessions/${id}`),
    turns: (id: string) => call<SessionTurn[]>(`${base}/sessions/${id}/turns`),
    changes: (id: string) => call<SessionChanges>(`${base}/sessions/${id}/changes`),
    sandbox: (id: string) => call<SandboxStatus>(`${base}/sessions/${id}/sandbox`),
    drop: (id: string, reason: string) => call<{ state: string }>(`${base}/sessions/${id}/drop`, post({ reason })),
    retry: (id: string, guidance: string) => call<{ state: string }>(`${base}/sessions/${id}/retry`, post({ guidance })),
    steer: (id: string, message: string) => call<{ ok: boolean }>(`${base}/sessions/${id}/steer`, post({ message })),
    prompt: (prompt: string) => call<SubmitResult>(`${base}/prompts`, post({ prompt })),
    settings: () => call<ProjectSettingsView>(`${base}/settings`),
    saveSettings: (update: ProjectSettingsUpdate) => call<ProjectSettingsView>(`${base}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
    git: () => call<{ settings: GitLinkView | null; state: SyncState | null }>(`${base}/git`),
    syncGit: () => call<{ ok: boolean }>(`${base}/git/sync`, { method: "POST" }),
    overview: () => call<OverviewState>(`${base}/overview`),
    readCode: () => call<OverviewState>(`${base}/overview`, { method: "POST" }),
  };
}

export type ProjectApi = ReturnType<typeof projectApi>;
