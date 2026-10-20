import type { AppStatus } from "../ports/app-host.ts";

export type CloudflareTone = "run" | "ok" | "bad" | "idle" | "gone";

export type CloudflareKind = "repo" | "branch" | "container" | "app" | "worker" | "durable-object" | "workflow" | "vectorize";

export interface CloudflareFact {
  readonly label: string;
  readonly value: string;
  readonly copy?: boolean;
  readonly href?: string;
}

export interface CloudflareResource {
  readonly key: string;
  readonly group: "session" | "project";
  readonly kind: CloudflareKind;
  readonly title: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly state?: { readonly tone: CloudflareTone; readonly text: string };
  readonly facts: readonly CloudflareFact[];
  readonly dashboard: string | null;
  readonly spent?: SandboxSpent;
}

export interface SandboxSpent {
  readonly micros: number;
  readonly seconds: number;
}

export interface CloudflareView {
  readonly accountId: string | null;
  readonly engine: string;
  readonly resources: readonly CloudflareResource[];
}

export interface SandboxFacts {
  readonly name: string;
  readonly objectId: string;
  readonly running: boolean;
  readonly exit: string | null;
  readonly size?: string | null;
  readonly spent?: SandboxSpent | null;
}

export interface CloudflareFacts {
  readonly accountId: string | null;
  readonly engine: string;
  readonly project: string;
  readonly router: string;
  readonly projectObject: string;
  readonly namespaces: Readonly<Partial<Record<"ProjectAgent" | "SessionAgent", string>>>;
  readonly containerApp: { readonly name: string; readonly id: string | null };
  readonly main: { readonly remote: string | null; readonly commitId: string | null };
  readonly session: null | {
    readonly id: string;
    readonly fork: string;
    readonly remote: string | null;
    readonly removed: "merged" | "dropped" | null;
    readonly head: string | null;
    readonly lanes: readonly { readonly role: string; readonly branch: string; readonly head: string | null }[];
  };
  readonly agents: { readonly sandbox: readonly string[]; readonly engine: readonly string[] };
  readonly sandboxes: { readonly session: SandboxFacts | null; readonly main: SandboxFacts | null };
  readonly app: { readonly name: string; readonly url: string | null; readonly status: AppStatus | null; readonly commitId: string | null } | null;
  readonly mainApp: { readonly url: string | null; readonly commitId: string; readonly status: AppStatus } | null;
}

export function engineOf(prefix: string): string {
  return prefix.replace(/-+$/, "") || "chef";
}

export function dashboardLink(accountId: string | null, path: string): string {
  return accountId ? `https://dash.cloudflare.com/${accountId}/${path}` : `https://dash.cloudflare.com/?to=/:account/${path}`;
}

const unique = (list: readonly string[]) => [...new Set(list)];

const short = (id: string | null | undefined) => (id ? id.slice(0, 12) : "none");

function sandbox(facts: CloudflareFacts, key: string, title: string, box: SandboxFacts, roles: readonly string[], runs: string, group: CloudflareResource["group"] = "session"): CloudflareResource {
  return {
    key,
    group,
    kind: "container",
    title,
    name: box.name,
    roles,
    state: box.running ? { tone: "run", text: "Running" } : { tone: "idle", text: "Sleeping" },
    facts: [
      { label: "Application", value: facts.containerApp.id ? `${facts.containerApp.name} · ${facts.containerApp.id}` : facts.containerApp.name },
      { label: "Durable Object", value: facts.namespaces.SessionAgent ? `SessionAgent · ${facts.namespaces.SessionAgent}` : "SessionAgent" },
      { label: "Object ID", value: box.objectId, copy: true },
      { label: "Runs", value: runs },
      ...(box.size ? [{ label: "Size", value: box.size }] : []),
      ...(box.exit ? [{ label: "Last exit", value: box.exit }] : []),
    ],
    dashboard: dashboardLink(facts.accountId, "workers/containers"),
    ...(box.spent ? { spent: box.spent } : {}),
  };
}

export function cloudflareView(facts: CloudflareFacts): CloudflareView {
  const s = facts.session;
  const box = facts.sandboxes.session;
  const laneRoles = s ? s.lanes.map((l) => l.role) : [];
  const engineRoles = facts.agents.engine;
  const coders = unique([...facts.agents.sandbox, ...laneRoles]);
  const reviewer = engineRoles.filter((r) => r === "reviewer");
  const workerPage = (name: string, tab = "") => dashboardLink(facts.accountId, `workers/services/view/${encodeURIComponent(name)}/production${tab}`);
  const resources: CloudflareResource[] = [];
  if (s && box) {
    resources.push(
      {
        key: "fork",
        group: "session",
        kind: "repo",
        title: "Artifacts repo",
        name: `${facts.engine}/${s.fork}`,
        roles: unique([...coders, ...reviewer]),
        state: s.removed === "merged" ? { tone: "gone", text: "Removed after merge" } : s.removed === "dropped" ? { tone: "gone", text: "Removed, kept as an archive branch" } : { tone: "ok", text: "Active" },
        facts: [
          { label: "Namespace", value: facts.engine },
          { label: "Branch", value: laneRoles.length ? `main, plus one branch per role` : "main" },
          { label: "Head", value: short(s.head) },
          ...(s.remote ? [{ label: "Git remote", value: s.remote, copy: true }] : []),
          { label: "Forked from", value: `${facts.engine}/${facts.project}` },
          ...(s.removed === "dropped" && s.head ? [{ label: "Archive", value: `${facts.engine}/${facts.project} archive/${s.id}` }] : []),
        ],
        dashboard: null,
      },
      ...s.lanes.map(
        (lane): CloudflareResource => ({
          key: `branch:${lane.role}`,
          group: "session",
          kind: "branch",
          title: "Role branch",
          name: lane.branch,
          roles: [lane.role],
          facts: [
            { label: "Repo", value: `${facts.engine}/${s.fork}` },
            { label: "Head", value: short(lane.head) },
          ],
          dashboard: null,
        }),
      ),
      sandbox(facts, "sandbox", "Sandbox container", box, unique([...facts.agents.sandbox, ...laneRoles]), `${facts.agents.sandbox.length ? "agent turns on main, " : ""}${laneRoles.length ? "each role's turns on its own branch in its own folder, " : ""}the final checks and this build's running app`),
    );
  }
  if (s && box && facts.app) {
    const app = facts.app;
    resources.push({
      key: "app",
      group: "session",
      kind: "app",
      title: "App address",
      name: app.name,
      roles: [],
      state: appState(app.status, box.running),
      facts: [
        { label: "Router", value: facts.router },
        { label: "Forwards to", value: `the sandbox ${box.name}` },
        ...(app.commitId ? [{ label: "Built from", value: short(app.commitId) }] : []),
        ...(app.url ? [{ label: "URL", value: app.url, href: app.url }] : []),
      ],
      dashboard: workerPage(facts.router, "/deployments"),
    });
  }
  if (facts.sandboxes.main) resources.push(sandbox(facts, "sandbox:main", "Main sandbox", facts.sandboxes.main, [], "the running app of main, the release candidate", "project"));
  resources.push(
    {
      key: "main-app",
      group: "project",
      kind: "app",
      title: "App of main",
      name: `${facts.project} main`,
      roles: [],
      state: appState(facts.mainApp?.status ?? null, facts.sandboxes.main?.running ?? true),
      facts: [...(facts.mainApp?.commitId ? [{ label: "Main", value: short(facts.mainApp.commitId) }] : []), ...(facts.mainApp?.url ? [{ label: "URL", value: facts.mainApp.url, href: facts.mainApp.url }] : [])],
      dashboard: null,
    },
    {
      key: "router",
      group: "project",
      kind: "worker",
      title: "App router",
      name: facts.router,
      roles: [],
      facts: [{ label: "Does", value: "gives each branch's running app its own address and forwards visits to that branch's sandbox; your app itself never runs on Workers" }],
      dashboard: workerPage(facts.router),
    },
    {
      key: "main",
      group: "project",
      kind: "repo",
      title: "Artifacts repo",
      name: `${facts.engine}/${facts.project}`,
      roles: engineRoles.filter((r) => r === "planner"),
      facts: [{ label: "Main", value: short(facts.main.commitId) }, ...(facts.main.remote ? [{ label: "Git remote", value: facts.main.remote, copy: true }] : [])],
      dashboard: null,
    },
    {
      key: "engine",
      group: "project",
      kind: "worker",
      title: "Chef engine",
      name: facts.engine,
      roles: engineRoles,
      facts: [{ label: "Runs", value: "this app, plus the planning and review calls to the model" }],
      dashboard: workerPage(facts.engine),
    },
    {
      key: "project-object",
      group: "project",
      kind: "durable-object",
      title: "Durable Object",
      name: `ProjectAgent ${facts.project}`,
      roles: engineRoles,
      facts: [
        { label: "Namespace", value: facts.namespaces.ProjectAgent ? `${facts.engine} ProjectAgent · ${facts.namespaces.ProjectAgent}` : `${facts.engine} ProjectAgent` },
        { label: "Object ID", value: facts.projectObject, copy: true },
      ],
      dashboard: dashboardLink(facts.accountId, "workers/durable-objects"),
    },
    {
      key: "workflow",
      group: "project",
      kind: "workflow",
      title: "Workflow",
      name: facts.engine === "chef" ? "upstream-sync" : `${facts.engine}-upstream-sync`,
      roles: [],
      facts: [{ label: "Does", value: "tells Chef when main gets a new commit, so open builds catch up" }],
      dashboard: dashboardLink(facts.accountId, "workers/workflows"),
    },
    {
      key: "memory",
      group: "project",
      kind: "vectorize",
      title: "Vectorize index",
      name: `${facts.engine}-memory`,
      roles: coders,
      facts: [
        { label: "Namespace", value: facts.project },
        { label: "Holds", value: "lessons Chef learned in this project" },
      ],
      dashboard: null,
    },
  );
  return { accountId: facts.accountId, engine: facts.engine, resources };
}

function appState(status: AppStatus | null, awake: boolean): NonNullable<CloudflareResource["state"]> {
  if (status === "running") return awake ? { tone: "ok", text: "Running" } : { tone: "idle", text: "Asleep, wakes on a visit" };
  if (status === "starting") return { tone: "run", text: "Starting" };
  if (status === "failed") return { tone: "bad", text: "Could not start" };
  if (status === "no-stack") return { tone: "idle", text: "No app to run" };
  return { tone: "idle", text: "Not started yet" };
}

export function agentsOf(record: { readonly kind?: "feature" | "chore"; readonly plan: { readonly items: readonly { readonly id: string; readonly role: string }[] }; readonly lanes?: readonly { readonly items: readonly string[] }[] | null }): CloudflareFacts["agents"] {
  const inLanes = new Set((record.lanes ?? []).flatMap((lane) => lane.items));
  return {
    sandbox: unique(record.plan.items.filter((item) => !inLanes.has(item.id)).map((item) => item.role)),
    engine: record.kind === "chore" ? ["reviewer"] : ["planner", "reviewer"],
  };
}
