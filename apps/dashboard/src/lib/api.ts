import { readSetupStream, SETUP_STREAM, type SetupEvent } from "@chef/core/setup";
import type { AgentConfig, AgentsView, Budget, FeatureSpec, LiveStatus, OutboundMode, RouteDecision, SessionChanges, SessionRecord, SessionTurn, SubmitResult, SyncState } from "@chef/core";

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
  readonly password: Source | "none";
  readonly runsOn?: "computer";
  readonly dataDir?: string;
}

export interface ComputerState {
  readonly status: "off" | "starting" | "ready" | "failed";
  readonly log: readonly string[];
  readonly error: string | null;
}

export interface CloudflareSetup {
  readonly status: "idle" | "running" | "done" | "failed";
  readonly log: readonly string[];
  readonly url: string | null;
  readonly error: string | null;
}

export interface AppMode {
  readonly mode: "local" | "cloud";
  readonly place: "computer" | "cloud" | null;
  readonly engine: string | null;
  readonly fixed: boolean;
  readonly computer?: ComputerState;
  readonly docker?: string | null;
  readonly setup?: CloudflareSetup;
  readonly claimed?: boolean;
  readonly account?: string | null;
}

export interface CloudflareCheck {
  readonly deployed: boolean;
  readonly url: string | null;
}

const CLOUD: AppMode = { mode: "cloud", place: "cloud", engine: null, fixed: true };
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const appApi = {
  get: () => call<AppMode>("/api/app").catch(() => CLOUD),
  useComputer: () => call<AppMode>("/api/app/place", json("PUT", { place: "computer" })),
  connect: (url: string, password: string) => call<AppMode>("/api/app/connection", json("PUT", { url, password })),
  disconnect: () => call<AppMode>("/api/app/connection", { method: "DELETE" }),
  checkCloudflare: (accountId: string, apiToken: string) => call<CloudflareCheck>("/api/app/cloudflare/check", json("POST", { accountId, apiToken })),
  deployCloudflare: (accountId: string, apiToken: string, password: string) => call<AppMode>("/api/app/cloudflare/deploy", json("POST", { accountId, apiToken, password })),
};

export type SettingsUpdate = Readonly<Record<string, unknown>>;

export const settingsApi = {
  get: () => call<SettingsView>("/api/settings"),
  save: (update: SettingsUpdate) => call<SettingsView>("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
};

export function agentsApi(project: string | null) {
  const base = project ? `/api/projects/${project}/agents` : "/api/agents";
  return {
    get: () => call<AgentsView>(base),
    save: (config: AgentConfig, summary: string, version: number) => call<AgentsView>(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, summary, version }) }),
    restore: (version: number) => call<AgentsView>(`${base}/restore`, post({ version })),
  };
}

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

export type SetupNote = Extract<SetupEvent, { type: "step" | "log" }>;

export interface CreatedProject {
  readonly name: string;
  readonly created: boolean;
  readonly imported?: boolean;
}

async function createProject(project: NewProject, onNote: (note: SetupNote) => void = () => undefined): Promise<CreatedProject> {
  const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json", accept: SETUP_STREAM }, body: JSON.stringify(project) });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `${response.status} ${response.statusText}`, response.status);
  }
  if (!(response.headers.get("content-type") ?? "").includes(SETUP_STREAM)) return (await response.json()) as CreatedProject;
  for await (const event of readSetupStream(response)) {
    if (event.type === "done") return event.result as unknown as CreatedProject;
    if (event.type === "error") throw new ApiError(event.error, event.status);
    onNote(event);
  }
  throw new ApiError("the connection closed before setup finished; reload to see whether the project was created", 502);
}

export const projectsApi = {
  list: () => call<{ projects: ProjectEntry[] }>("/api/projects").then((r) => r.projects),
  create: createProject,
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
  readonly available?: false;
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
  readonly attempts?: number | null;
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
  readonly attempts?: number | null;
  readonly git?: GitLinkUpdate | null;
}

export interface EnvVarView {
  readonly name: string;
  readonly secret: boolean;
  readonly value: string | null;
  readonly updatedAt: number;
  readonly scope?: "shared" | "overrides";
}

export interface EnvNeedView {
  readonly name: string;
  readonly features: readonly string[];
}

export interface ProjectEnvView {
  readonly vars: readonly EnvVarView[];
  readonly needs: readonly EnvNeedView[];
}

export interface EnvUpdate {
  readonly set?: Readonly<Record<string, { readonly value: string; readonly secret: boolean }>>;
  readonly remove?: readonly string[];
}

export interface EnvApi {
  env(): Promise<ProjectEnvView>;
  saveEnv(update: EnvUpdate): Promise<ProjectEnvView>;
}

export const sharedEnvApi: EnvApi = {
  env: () => call<ProjectEnvView>("/api/env"),
  saveEnv: (update) => call<ProjectEnvView>("/api/env", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
};

export interface LiveApp {
  readonly status: LiveStatus;
  readonly commitId: string;
  readonly url: string | null;
  readonly error?: string;
  readonly at: number;
}

export interface ProjectSpec {
  readonly commitId: string | null;
  readonly features: readonly FeatureSpec[];
  readonly live?: LiveApp | null;
}

export function projectApi(project: string) {
  const base = `/api/projects/${project}`;
  return {
    spec: () => call<ProjectSpec>(`${base}/spec`),
    redeployLive: () => call<{ ok: boolean }>(`${base}/live`, { method: "POST" }),
    sessions: () => call<SessionRecord[]>(`${base}/sessions`),
    session: (id: string) => call<{ record: SessionRecord; budget: Budget }>(`${base}/sessions/${id}`),
    turns: (id: string) => call<SessionTurn[]>(`${base}/sessions/${id}/turns`),
    changes: (id: string) => call<SessionChanges>(`${base}/sessions/${id}/changes`),
    sandbox: (id: string) => call<SandboxStatus>(`${base}/sessions/${id}/sandbox`),
    drop: (id: string, reason: string) => call<{ state: string }>(`${base}/sessions/${id}/drop`, post({ reason })),
    retry: (id: string, guidance: string) => call<{ state: string }>(`${base}/sessions/${id}/retry`, post({ guidance })),
    steer: (id: string, message: string) => call<{ ok: boolean }>(`${base}/sessions/${id}/steer`, post({ message })),
    prompt: (prompt: string) => call<SubmitResult>(`${base}/prompts`, post({ prompt })),
    route: (prompt: string) => call<RouteDecision>(`${base}/route`, post({ prompt })),
    settings: () => call<ProjectSettingsView>(`${base}/settings`),
    saveSettings: (update: ProjectSettingsUpdate) => call<ProjectSettingsView>(`${base}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
    git: () => call<{ settings: GitLinkView | null; state: SyncState | null }>(`${base}/git`),
    syncGit: () => call<{ ok: boolean }>(`${base}/git/sync`, { method: "POST" }),
    env: () => call<ProjectEnvView>(`${base}/env`),
    saveEnv: (update: EnvUpdate) => call<ProjectEnvView>(`${base}/env`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
    overview: () => call<OverviewState>(`${base}/overview`),
    readCode: () => call<OverviewState>(`${base}/overview`, { method: "POST" }),
  };
}

export type ProjectApi = ReturnType<typeof projectApi>;
