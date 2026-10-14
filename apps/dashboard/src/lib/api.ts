import { readSetupStream, SETUP_STREAM, type SetupEvent } from "@chef/core/setup";
import type { AgentConfig, AgentsView, Budget, CloudflareView, FeatureArrangement, FeatureLayout, FeatureSpec, LearnedRule, LiveStatus, MemoryEntry, OutboundMode, RouteDecision, SessionChanges, SessionRecord, SessionTurn, SubmitResult, SyncState } from "@chef/core";

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
  readonly models: { readonly planner: string; readonly reviewer: string; readonly coder: string; readonly voice: string; readonly source: Source };
  readonly attempts: { readonly value: number; readonly source: Source };
  readonly password: Source;
}

export type OrgRole = "owner" | "admin" | "member";

export interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly role: OrgRole;
  readonly personal: boolean;
  readonly plan: "free";
}

export interface OrgView extends OrgSummary {
  readonly engine: string | null;
  readonly members: number;
}

export interface OrgMember {
  readonly userId: string;
  readonly email: string | null;
  readonly role: OrgRole;
  readonly joinedAt: number;
}

export interface OrgInvite {
  readonly email: string;
  readonly role: OrgRole;
  readonly createdAt: number;
}

export interface OrgPeople {
  readonly members: readonly OrgMember[];
  readonly invites: readonly OrgInvite[];
}

export type ProjectLevel = "view" | "edit" | "manage";

export interface ProjectSharing {
  readonly name: string;
  readonly visibility: "private" | "org";
  readonly orgLevel: ProjectLevel;
  readonly createdBy: string | null;
  readonly people: readonly { readonly userId: string; readonly email: string | null; readonly level: ProjectLevel }[];
}

export interface ProjectAccess {
  readonly you: ProjectLevel;
  readonly sharing?: ProjectSharing;
  readonly members?: readonly OrgMember[];
}

export interface UpdateOffer {
  readonly running: boolean;
  readonly canUpdate: boolean;
  readonly ask: boolean;
}

export interface AppMode {
  readonly engine: string | null;
  readonly account?: string | null;
  readonly org?: OrgView | null;
  readonly orgs?: readonly OrgSummary[];
  readonly update?: UpdateOffer | null;
}

export type UpdateStepId = "account" | "image" | "token" | "deploy";

export interface UpdateRun {
  readonly status: "idle" | "running" | "done" | "failed";
  readonly steps: Readonly<Record<UpdateStepId, "waiting" | "running" | "done" | "failed" | "skipped">>;
  readonly log: readonly string[];
  readonly error: string | null;
}

export interface UpdateState {
  readonly running: boolean;
  readonly install: UpdateRun | null;
}

const CLOUD: AppMode = { engine: null };
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function appMode(tries = 3): Promise<AppMode> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call<AppMode>("/api/app");
    } catch {
      if (attempt >= tries) return CLOUD;
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
    }
  }
}

export const appApi = {
  get: () => appMode(),
};

export const updateApi = {
  state: () => call<UpdateState>("/site/api/update"),
  start: () => call<UpdateState>("/site/api/update", json("POST", {})),
  later: () => call<{ readonly ok: true }>("/site/api/update/later", json("POST", {})),
  finish: () => call<{ readonly ok: true }>("/site/api/install", { method: "DELETE" }),
};

export const orgApi = {
  create: (name: string) => call<{ readonly org: OrgSummary }>("/site/api/orgs", json("POST", { name })),
  use: (orgId: string) => call<{ readonly org: OrgSummary }>("/site/api/orgs/switch", json("POST", { orgId })),
  rename: (name: string) => call<{ readonly org: OrgView }>("/site/api/org", json("PATCH", { name })),
  people: () => call<OrgPeople>("/site/api/org/members"),
  invite: (email: string, role: OrgRole) => call<OrgPeople & { readonly status: "added" | "invited" }>("/site/api/org/members", json("POST", { email, role })),
  setRole: (userId: string, role: OrgRole) => call<{ readonly members: readonly OrgMember[] }>(`/site/api/org/members/${userId}`, json("PATCH", { role })),
  remove: (userId: string) => call<{ readonly members: readonly OrgMember[] }>(`/site/api/org/members/${userId}`, { method: "DELETE" }),
  cancelInvite: (email: string) => call<{ readonly invites: readonly OrgInvite[] }>(`/site/api/org/invites/${encodeURIComponent(email)}`, { method: "DELETE" }),
};

export function sharingApi(project: string) {
  const base = `/site/api/projects/${project}/access`;
  return {
    get: () => call<ProjectAccess>(base),
    share: (visibility: ProjectSharing["visibility"], orgLevel: ProjectLevel) => call<ProjectAccess>(base, json("PUT", { visibility, orgLevel })),
    setLevel: (userId: string, level: ProjectLevel | null) => call<ProjectAccess>(`${base}/${userId}`, level ? json("PUT", { level }) : { method: "DELETE" }),
  };
}

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
  readonly access?: ProjectLevel;
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
  readonly layout?: FeatureLayout;
}

export interface ProjectBudget {
  readonly month: string;
  readonly spent: number;
  readonly cap: number | null;
}

export interface Spending {
  readonly caps: { readonly org: number | null; readonly projects: Readonly<Record<string, number>>; readonly members: Readonly<Record<string, number>> };
  readonly ledger: { readonly month: string; readonly org: number; readonly projects: Readonly<Record<string, number>>; readonly members: Readonly<Record<string, number>> };
}

export const usageApi = {
  get: () => call<Spending>("/api/usage"),
  save: (caps: { readonly org?: number | null; readonly members?: Readonly<Record<string, number | null>> }) => call<Spending>("/api/usage", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(caps) }),
};

export function projectApi(project: string) {
  const base = `/api/projects/${project}`;
  return {
    spec: () => call<ProjectSpec>(`${base}/spec`),
    redeployLive: () => call<{ ok: boolean }>(`${base}/live`, { method: "POST" }),
    arrange: (id: string, change: FeatureArrangement) => call<{ layout: FeatureLayout }>(`${base}/features/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }),
    removeFeature: (id: string) => call<{ featureIds: string[]; commitId: string | null }>(`${base}/features/${id}`, { method: "DELETE" }),
    sessions: () => call<SessionRecord[]>(`${base}/sessions`),
    session: (id: string) => call<{ record: SessionRecord; budget: Budget }>(`${base}/sessions/${id}`),
    turns: (id: string) => call<SessionTurn[]>(`${base}/sessions/${id}/turns`),
    changes: (id: string) => call<SessionChanges>(`${base}/sessions/${id}/changes`),
    cloudflare: (id: string) => call<CloudflareView>(`${base}/sessions/${id}/cloudflare`),
    drop: (id: string, reason: string) => call<{ state: string }>(`${base}/sessions/${id}/drop`, post({ reason })),
    retry: (id: string, guidance: string) => call<{ state: string }>(`${base}/sessions/${id}/retry`, post({ guidance })),
    steer: (id: string, message: string) => call<{ ok: boolean }>(`${base}/sessions/${id}/steer`, post({ message })),
    prompt: (prompt: string) => call<SubmitResult>(`${base}/prompts`, post({ prompt })),
    route: (prompt: string) => call<RouteDecision>(`${base}/route`, post({ prompt })),
    settings: () => call<ProjectSettingsView>(`${base}/settings`),
    budget: () => call<ProjectBudget>(`${base}/budget`),
    saveBudget: (cap: number | null) => call<ProjectBudget>(`${base}/budget`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cap }) }),
    saveSettings: (update: ProjectSettingsUpdate) => call<ProjectSettingsView>(`${base}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
    git: () => call<{ settings: GitLinkView | null; state: SyncState | null }>(`${base}/git`),
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
