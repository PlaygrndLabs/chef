import { readSetupStream, SETUP_STREAM, type SetupEvent } from "@chef/core/setup";
import type { AgentConfig, AgentsView, AppStatus, Budget, CloudflareView, CommitChanges, FeatureArrangement, FeatureLayout, FeatureMap, FeatureSpec, MapEdit, LearnedRule, MainHistory, MemoryEntry, OutboundMode, RouteDecision, SessionChanges, SessionHistory, SessionRecord, SessionTurn, SubmitResult, SyncState } from "@chef/core";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `${response.status} ${response.statusText}`, response.status);
  }
  return (await response.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export type Source = "app" | "deployment" | "managed";

export interface ProviderView {
  readonly kind: string;
  readonly baseUrl: string | null;
  readonly keyHint: string;
  readonly source: Source;
}

export interface SettingsView {
  readonly managed: { readonly by: string } | null;
  readonly llm: ProviderView | null;
  readonly voice: ProviderView | null;
  readonly jev: { readonly keyHint: string; readonly source: Source } | null;
  readonly cloudflare: { readonly accountId: string; readonly keyHint: string; readonly source: Source } | null;
  readonly models: { readonly planner: string; readonly reviewer: string; readonly coder: string; readonly voice: string; readonly source: Source };
  readonly attempts: { readonly value: number; readonly source: Source };
  readonly password: Source | "none";
}

export const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export type SettingsUpdate = Readonly<Record<string, unknown>>;

export interface ApiKeyView {
  readonly id: string;
  readonly prefix: string;
  readonly kind: "controller" | "key";
  readonly name: string;
  readonly scopes: readonly string[];
  readonly source: Source;
  readonly createdAt: number | null;
  readonly expiresAt: number | null;
  readonly lastUsedAt: number | null;
}

export interface NewApiKey {
  readonly name: string;
  readonly kind: "controller" | "key";
  readonly expiresInDays: number | null;
}

export const keysApi = {
  list: () => call<{ readonly keys: readonly ApiKeyView[] }>("/api/keys").then((view) => view.keys),
  create: (key: NewApiKey) => call<{ readonly key: ApiKeyView; readonly token: string }>("/api/keys", post(key)),
  revoke: async (id: string) => {
    const response = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (!response.ok) throw new ApiError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `${response.status} ${response.statusText}`, response.status);
  },
};

export type ShareKind = "session" | "app";

export interface ShareView {
  readonly shareId: string;
  readonly kind: ShareKind;
  readonly project: string;
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly lastUsedAt: number | null;
}

export function sharesApi(project: string) {
  return {
    list: () => call<{ readonly shares: readonly ShareView[] }>(`/api/projects/${project}/shares`).then((view) => view.shares),
    create: (share: { readonly kind: ShareKind; readonly id: string; readonly expiresInDays: number | null }) => call<{ readonly share: ShareView; readonly token: string }>(`/api/projects/${project}/shares`, post(share)),
    revoke: async (shareId: string) => {
      const response = await fetch(`/api/shares/${shareId}`, { method: "DELETE" });
      if (!response.ok) throw new ApiError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `${response.status} ${response.statusText}`, response.status);
    },
    closeOpenApps: async () => {
      const response = await fetch(`/api/projects/${project}/app-key`, { method: "POST" });
      if (!response.ok) throw new ApiError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `${response.status} ${response.statusText}`, response.status);
    },
  };
}

export const SHARE_PAGE = "/s";

export function isSharePage(pathname: string): boolean {
  return pathname === SHARE_PAGE || /^\/s\/[A-Za-z0-9_-]{1,80}$/.test(pathname);
}

export function shareLink(origin: string, token: string): string {
  return `${origin}${SHARE_PAGE}#${token}`;
}

export interface SharedTarget {
  readonly kind: ShareKind;
  readonly project: string;
  readonly id: string;
  readonly name: string;
  readonly expiresAt: number | null;
}

export function sharedApi(input: { readonly base: string; readonly headers?: Readonly<Record<string, string>> }) {
  const { base } = input;
  const init = (): RequestInit => ({ headers: { ...input.headers }, cache: "no-store" });
  return {
    target: () => call<SharedTarget>(`${base}/api/share`, init()),
    session: (project: string, id: string) => call<{ record: SessionRecord }>(`${base}/api/projects/${project}/sessions/${id}`, init()),
    turns: (project: string, id: string) => call<SessionTurn[]>(`${base}/api/projects/${project}/sessions/${id}/turns`, init()),
    changes: (project: string, id: string) => call<SessionChanges>(`${base}/api/projects/${project}/sessions/${id}/changes`, init()),
    appState: (link: string, retry: boolean) => fetch(`${base}${link}?state=1${retry ? "&retry=1" : ""}`, init()).catch(() => null),
  };
}

export function linkApi(token: string) {
  return token ? sharedApi({ base: "", headers: { authorization: `Bearer ${token}` } }) : null;
}

export type SharedApi = ReturnType<typeof sharedApi>;

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
  readonly updatedAt?: number;
  readonly note?: string;
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

export interface RemovedProject {
  readonly name: string;
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

export const projectsApi = {
  list: () => call<{ projects: ProjectEntry[] }>("/api/projects").then((r) => r.projects),
  create: createProject,
  remove: (name: string) => call<RemovedProject>(`/api/projects/${name}`, json("DELETE", { confirm: name })),
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
  readonly shared?: boolean;
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
  readonly appIdleMinutes: number;
  readonly attempts?: number | null;
  readonly merge?: "auto" | "manual";
  readonly git: GitLinkView | null;
}

export interface GitLinkUpdate {
  readonly url: string;
  readonly branch?: string;
  readonly token?: string;
  readonly github?: boolean;
  readonly mode: OutboundMode;
  readonly syncBranch: string;
}

export interface ProjectSettingsUpdate {
  readonly appIdleMinutes?: number | null;
  readonly attempts?: number | null;
  readonly merge?: "auto" | "manual";
  readonly git?: GitLinkUpdate | null;
}

export interface EnvVarView {
  readonly name: string;
  readonly secret: boolean;
  readonly value: string | null;
  readonly hint?: string;
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

export interface SharedInstructionsView {
  readonly text: string;
  readonly at: number;
}

export const sharedInstructionsApi = {
  get: () => call<SharedInstructionsView>("/api/instructions"),
  save: (text: string, previous: string) => call<SharedInstructionsView>("/api/instructions", json("PUT", { text, previous })),
};

export interface InstructionsView {
  readonly goal: string;
  readonly instructions: string;
  readonly shared: string;
  readonly commitId: string | null;
}

export interface MemoryView {
  readonly commitId: string | null;
  readonly entries: readonly MemoryEntry[];
  readonly rules: readonly LearnedRule[];
}

export interface MainApp {
  readonly status: AppStatus;
  readonly commitId: string;
  readonly url: string | null;
  readonly error?: string;
  readonly at: number;
}

export interface ProjectSpec {
  readonly commitId: string | null;
  readonly features: readonly FeatureSpec[];
  readonly map?: FeatureMap;
  readonly mainApp?: MainApp | null;
  readonly layout?: FeatureLayout;
  readonly fresh?: boolean;
}

export interface ProjectBudget {
  readonly month: string;
  readonly spent: number;
  readonly cap: number | null;
}

export interface Spending {
  readonly caps: { readonly org: number | null; readonly projects: Readonly<Record<string, number>>; readonly members: Readonly<Record<string, number>> };
  readonly ledger: { readonly month: string; readonly org: number; readonly projects: Readonly<Record<string, number>>; readonly members: Readonly<Record<string, number>>; readonly parts?: Readonly<Partial<Record<"model" | "router" | "voice", number>>> };
}

export const usageApi = {
  get: () => call<Spending>("/api/usage"),
  save: (caps: { readonly org?: number | null; readonly members?: Readonly<Record<string, number | null>> }) => call<Spending>("/api/usage", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(caps) }),
};

export function projectApi(project: string) {
  const base = `/api/projects/${project}`;
  return {
    spec: () => call<ProjectSpec>(`${base}/spec`),
    restartMainApp: () => call<{ ok: boolean }>(`${base}/main-app`, { method: "POST" }),
    arrange: (id: string, change: FeatureArrangement) => call<{ layout: FeatureLayout }>(`${base}/features/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }),
    editMap: (edit: MapEdit) => call<{ commitId: string | null; id: string | null }>(`${base}/feature-map`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(edit) }),
    removeFeature: (id: string) => call<{ featureIds: string[]; commitId: string | null }>(`${base}/features/${id}`, { method: "DELETE" }),
    sessions: () => call<SessionRecord[]>(`${base}/sessions`),
    session: (id: string) => call<{ record: SessionRecord; budget: Budget }>(`${base}/sessions/${id}`),
    turns: (id: string) => call<SessionTurn[]>(`${base}/sessions/${id}/turns`),
    changes: (id: string) => call<SessionChanges>(`${base}/sessions/${id}/changes`),
    sessionHistory: (id: string) => call<SessionHistory>(`${base}/sessions/${id}/history`),
    sessionCommit: (id: string, commit: string) => call<CommitChanges>(`${base}/sessions/${id}/history/${commit}`),
    cloudflare: (id: string) => call<CloudflareView>(`${base}/sessions/${id}/cloudflare`),
    drop: (id: string, reason: string) => call<{ state: string }>(`${base}/sessions/${id}/drop`, post({ reason })),
    retry: (id: string, guidance: string) => call<{ state: string }>(`${base}/sessions/${id}/retry`, post({ guidance })),
    merge: (id: string) => call<{ state: string }>(`${base}/sessions/${id}/merge`, post({})),
    newVersion: (id: string, prompt?: string) => call<{ sessionId: string; version: number | null }>(`${base}/sessions/${id}/version`, post(prompt ? { prompt } : {})),
    steer: (id: string, message: string) => call<{ ok: boolean }>(`${base}/sessions/${id}/steer`, post({ message })),
    prompt: (prompt: string) => call<SubmitResult>(`${base}/prompts`, post({ prompt })),
    route: (prompt: string) => call<RouteDecision>(`${base}/route`, post({ prompt })),
    settings: () => call<ProjectSettingsView>(`${base}/settings`),
    budget: () => call<ProjectBudget>(`${base}/budget`),
    saveBudget: (cap: number | null) => call<ProjectBudget>(`${base}/budget`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cap }) }),
    saveSettings: (update: ProjectSettingsUpdate) => call<ProjectSettingsView>(`${base}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
    git: () => call<{ settings: GitLinkView | null; state: SyncState | null }>(`${base}/git`),
    history: (limit: number) => call<MainHistory>(`${base}/history?limit=${limit}`),
    commit: (id: string) => call<CommitChanges>(`${base}/history/${id}`),
    syncGit: () => call<{ ok: boolean }>(`${base}/git/sync`, { method: "POST" }),
    env: () => call<ProjectEnvView>(`${base}/env`),
    saveEnv: (update: EnvUpdate) => call<ProjectEnvView>(`${base}/env`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
    instructions: () => call<InstructionsView>(`${base}/instructions`),
    saveInstructions: (next: { readonly goal: string; readonly instructions: string }, previous: { readonly goal: string; readonly instructions: string }) => call<InstructionsView>(`${base}/instructions`, json("PUT", { ...next, previous })),
    memory: () => call<MemoryView>(`${base}/memory`),
    addNote: (title: string, text: string) => call<MemoryView & { readonly path: string | null }>(`${base}/memory`, post({ title, text })),
    editMemory: (path: string, text: string | null, previous: string) => call<MemoryView>(`${base}/memory`, json("PUT", { path, text, previous })),
    overview: () => call<OverviewState>(`${base}/overview`),
    readCode: () => call<OverviewState>(`${base}/overview`, { method: "POST" }),
  };
}

export type ProjectApi = ReturnType<typeof projectApi>;
