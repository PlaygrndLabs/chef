export type CloudflareTone = "run" | "ok" | "bad" | "idle" | "gone";

export type CloudflareKind = "repo" | "branch" | "container" | "preview" | "worker" | "durable-object" | "workflow" | "vectorize";

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
  readonly role?: string;
  readonly state?: { readonly tone: CloudflareTone; readonly text: string };
  readonly facts: readonly CloudflareFact[];
  readonly dashboard: string | null;
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
}

export interface CloudflareFacts {
  readonly accountId: string | null;
  readonly engine: string;
  readonly project: string;
  readonly projectWorker: string;
  readonly projectObject: string;
  readonly namespaces: Readonly<Partial<Record<"ProjectAgent" | "SessionAgent", string>>>;
  readonly containerApp: { readonly name: string; readonly id: string | null };
  readonly main: { readonly remote: string | null; readonly commitId: string | null };
  readonly session: {
    readonly id: string;
    readonly fork: string;
    readonly remote: string | null;
    readonly removed: "merged" | "dropped" | null;
    readonly head: string | null;
    readonly lanes: readonly { readonly role: string; readonly branch: string; readonly head: string | null }[];
  };
  readonly sandboxes: { readonly session: SandboxFacts; readonly lanes: Readonly<Record<string, SandboxFacts>>; readonly preview: SandboxFacts | null };
  readonly preview: { readonly name: string; readonly branch: string; readonly url: string | null; readonly versionId: string | null; readonly commitId: string | null; readonly awake: boolean } | null;
  readonly live: { readonly url: string | null; readonly commitId: string; readonly status: string } | null;
}

export function engineOf(prefix: string): string {
  return prefix.replace(/-+$/, "") || "chef";
}

export function dashboardLink(accountId: string | null, path: string): string {
  return accountId ? `https://dash.cloudflare.com/${accountId}/${path}` : `https://dash.cloudflare.com/?to=/:account/${path}`;
}

const short = (id: string | null | undefined) => (id ? id.slice(0, 12) : "none");

function sandbox(facts: CloudflareFacts, key: string, title: string, box: SandboxFacts, role?: string): CloudflareResource {
  return {
    key,
    group: "session",
    kind: "container",
    title,
    name: box.name,
    ...(role ? { role } : {}),
    state: box.running ? { tone: "run", text: "Running" } : { tone: "idle", text: "Sleeping" },
    facts: [
      { label: "Application", value: facts.containerApp.id ? `${facts.containerApp.name} · ${facts.containerApp.id}` : facts.containerApp.name },
      { label: "Durable Object", value: facts.namespaces.SessionAgent ? `SessionAgent · ${facts.namespaces.SessionAgent}` : "SessionAgent" },
      { label: "Object ID", value: box.objectId, copy: true },
      ...(box.exit ? [{ label: "Last exit", value: box.exit }] : []),
    ],
    dashboard: dashboardLink(facts.accountId, "workers/containers"),
  };
}

export function cloudflareView(facts: CloudflareFacts): CloudflareView {
  const s = facts.session;
  const workerPage = (name: string, tab = "") => dashboardLink(facts.accountId, `workers/services/view/${encodeURIComponent(name)}/production${tab}`);
  const resources: CloudflareResource[] = [
    {
      key: "fork",
      group: "session",
      kind: "repo",
      title: "Artifacts repo",
      name: `${facts.engine}/${s.fork}`,
      state: s.removed === "merged" ? { tone: "gone", text: "Removed after merge" } : s.removed === "dropped" ? { tone: "gone", text: "Removed, kept as an archive branch" } : { tone: "ok", text: "Active" },
      facts: [
        { label: "Namespace", value: facts.engine },
        { label: "Branch", value: "main" },
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
        role: lane.role,
        facts: [
          { label: "Repo", value: `${facts.engine}/${s.fork}` },
          { label: "Head", value: short(lane.head) },
        ],
        dashboard: null,
      }),
    ),
    sandbox(facts, "sandbox", "Sandbox container", facts.sandboxes.session),
    ...s.lanes.flatMap((lane) => {
      const box = facts.sandboxes.lanes[lane.role];
      return box ? [sandbox(facts, `sandbox:${lane.role}`, "Role sandbox", box, lane.role)] : [];
    }),
  ];
  if (facts.preview) {
    const p = facts.preview;
    resources.push({
      key: "preview",
      group: "session",
      kind: "preview",
      title: "Worker preview",
      name: p.name,
      state: p.versionId ? (p.awake ? { tone: "ok", text: "Awake" } : { tone: "idle", text: "Asleep" }) : p.url ? { tone: "idle", text: "Asleep, rebuilds on the next visit" } : { tone: "idle", text: "Not built yet" },
      facts: [
        { label: "Worker", value: facts.projectWorker },
        { label: "Branch", value: `${facts.engine}/${facts.project} ${p.branch}` },
        ...(p.versionId ? [{ label: "Version", value: p.versionId, copy: true }] : []),
        ...(p.commitId ? [{ label: "Built from", value: short(p.commitId) }] : []),
        ...(p.url ? [{ label: "URL", value: p.url, href: p.url }] : []),
      ],
      dashboard: workerPage(facts.projectWorker, "/deployments"),
    });
    if (facts.sandboxes.preview) resources.push(sandbox(facts, "sandbox:preview", "Preview builder", facts.sandboxes.preview));
  }
  resources.push(
    {
      key: "project-worker",
      group: "project",
      kind: "worker",
      title: "Live app Worker",
      name: facts.projectWorker,
      state: !facts.live ? { tone: "idle", text: "Not deployed yet" } : facts.live.status === "failed" ? { tone: "bad", text: "Last deploy failed" } : facts.live.status === "deploying" ? { tone: "run", text: "Deploying" } : { tone: "ok", text: "Live" },
      facts: [...(facts.live?.commitId ? [{ label: "Main", value: short(facts.live.commitId) }] : []), ...(facts.live?.url ? [{ label: "URL", value: facts.live.url, href: facts.live.url }] : [])],
      dashboard: workerPage(facts.projectWorker),
    },
    {
      key: "main",
      group: "project",
      kind: "repo",
      title: "Artifacts repo",
      name: `${facts.engine}/${facts.project}`,
      facts: [{ label: "Main", value: short(facts.main.commitId) }, ...(facts.main.remote ? [{ label: "Git remote", value: facts.main.remote, copy: true }] : [])],
      dashboard: null,
    },
    {
      key: "engine",
      group: "project",
      kind: "worker",
      title: "chef engine",
      name: facts.engine,
      facts: [{ label: "Runs", value: "this app, the planner, the reviewer and every agent" }],
      dashboard: workerPage(facts.engine),
    },
    {
      key: "project-object",
      group: "project",
      kind: "durable-object",
      title: "Durable Object",
      name: `ProjectAgent ${facts.project}`,
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
      facts: [{ label: "Does", value: "tells chef when main gets a new commit, so open builds catch up" }],
      dashboard: dashboardLink(facts.accountId, "workers/workflows"),
    },
    {
      key: "memory",
      group: "project",
      kind: "vectorize",
      title: "Vectorize index",
      name: `${facts.engine}-memory`,
      facts: [
        { label: "Namespace", value: facts.project },
        { label: "Holds", value: "lessons chef learned in this project" },
      ],
      dashboard: null,
    },
  );
  return { accountId: facts.accountId, engine: facts.engine, resources };
}
