import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { AgentSettings, ControlError, FEATURE_ROUTE, featureRequest, FEATURE_MAP_ROUTE, featureMapRequest, readFeatureMap, HISTORY_ROUTE, historyResponse, SESSION_HISTORY_ROUTE, sessionHistoryResponse, DEFAULT_BUDGET, DEFAULT_SPECIALIZATION, envNeeds, isTerminal, parseFeature, readSpec, SessionPump, agentsOf, cloudflareView, type CloudflareView, type FeatureSpec, type SandboxFacts, type SplitPart } from "@chef/core";
import { MemoryStore, type Script } from "@chef/core/fakes";
import { newToken } from "@chef/core/access";
import { agentsRequest, projectAgentsRequest } from "@chef/adapters/agents";
import { instructionsRequest, memoryRequest, sharedInstructionsRequest, type GuidanceHost, type SharedInstructions } from "@chef/adapters/guidance";
import { ChefAgent, type ChefLink } from "@chef/adapters/agui";
import { applyUpdate, describeSettings, NO_SETTINGS, resolveSettings, type AppSettings, type SettingsEnv } from "@chef/adapters/settings";
import { aesCipher, applyEnvUpdate, envKeyBytes, envNames, mergeEnv, newEnvKey, viewEnv, viewProjectEnv, type StoredEnv } from "@chef/adapters/project-env";
import { applyProjectUpdate, readProjectSettings, viewProjectSettings, type ProjectSettings } from "@chef/adapters/project-settings";
import { CopilotRuntime, InMemoryAgentRunner, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { createNodeFetchHandler } from "@copilotkit/runtime/v2/node";
import { benchScript } from "./bench/agent.ts";
import { BENCH_ITEMS, promptFor, specFor } from "./bench/items.ts";
import { demoScript } from "./demo.ts";
import { readTree } from "./fs.ts";
import { localWorld, REPO_ROOT, repoProfiles, templateTree } from "./world.ts";

export const TODO_PROMPT = "Add an item to a todo list";
export const TODO_CLOUD_PROMPT = "Add an item to a todo list that also syncs to TodoCloud";
export const TODO_SPLIT_PROMPT = "Let people shout and reverse their todo items";

function splits(): Map<string, readonly SplitPart[]> {
  return new Map([[TODO_SPLIT_PROMPT, BENCH_ITEMS.filter((item) => item.id === "shout" || item.id === "reverse").map((item): SplitPart => ({ kind: "new", prompt: promptFor(item), parent: "todo-add", path: `Use ${item.id} on an item.` }))]]);
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

function presets(): Map<string, FeatureSpec> {
  const todo = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
  if (!todo.ok) throw new Error(todo.errors.join("\n"));
  return new Map<string, FeatureSpec>([[TODO_PROMPT, todo.spec], [TODO_CLOUD_PROMPT, { ...todo.spec, env: ["TODOCLOUD_API_KEY"] }], ...BENCH_ITEMS.map((item) => [promptFor(item), specFor(item)] as const)]);
}

function script(): Script {
  const todo = demoScript(readTree(join(REPO_ROOT, "core", "test", "fixtures", "todo")));
  const bench = benchScript(BENCH_ITEMS);
  return (input, attempt) => {
    if (input.role === "chore") return { changes: { "README.md": `${input.workspace.tree["README.md"] ?? ""}\n${input.prompt}\n` }, summary: input.prompt };
    return input.featureId === "todo-add" ? todo(input, attempt) : bench(input, attempt);
  };
}

export interface LocalServer {
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

export async function serve(options: { readonly port: number; readonly project?: string; readonly real: boolean; readonly attempts?: number; readonly assets?: string; readonly settings?: SettingsEnv; readonly log?: (line: string) => void }): Promise<LocalServer> {
  const log = options.log ?? (() => {});
  let env: StoredEnv = {};
  let shared: StoredEnv = {};
  let instructions: SharedInstructions | null = null;
  const cipher = await aesCipher(envKeyBytes(newEnvKey()));
  const w = localWorld({ script: script(), presets: presets(), splits: splits(), real: options.real, config: { environment: async () => envNames(mergeEnv(shared, env)), instructions: async () => instructions?.text ?? "", merge: async () => readProjectSettings(projectSettings).merge, ...(options.attempts ? { specialization: { ...DEFAULT_SPECIALIZATION, attempts: options.attempts } } : {}) } });
  await w.orchestrator.bootstrap(templateTree());
  const pump = new SessionPump();
  const drive = (): void => {
    pump.kick(w.orchestrator, () => setTimeout(drive, 10)).catch((error: unknown) => log(`drive failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  const link: ChefLink = {
    cursor: async () => w.bus.log.length,
    submit: async (prompt) => {
      const result = await w.orchestrator.submit(prompt);
      if (result.sessionId) drive();
      return result;
    },
    events: async (after) => w.bus.log.slice(after, after + 500).map((event, i) => ({ seq: after + i + 1, event })),
  };
  let project: { readonly name: string; readonly createdAt: number } | null = options.project ? { name: options.project, createdAt: Date.now() } : null;
  process.env["COPILOTKIT_TELEMETRY_DISABLED"] ??= "true";
  const runtime = new CopilotRuntime({ agents: () => ({ default: new ChefAgent({ link, pollMs: 200 }) }), runner: new InMemoryAgentRunner({ onConcurrentRun: "supersede" }) });
  const copilotFor = (name: string) => createCopilotRuntimeHandler({ runtime, basePath: `/api/projects/${name}/copilotkit` });
  let copilot = project ? copilotFor(project.name) : null;
  const projects = async (request: Request): Promise<Response> => {
    if (request.method === "GET") return Response.json({ projects: project ? [project] : [] });
    const { name } = (await request.json().catch(() => ({}))) as { name?: string };
    if (!name || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) return Response.json({ error: "project names are 2 to 31 lower case letters, digits and dashes, starting with a letter" }, { status: 400 });
    if (project) return Response.json({ error: project.name === name ? `there is already a project named ${name}` : "the local server runs a single project" }, { status: 409 });
    project = { name, createdAt: Date.now() };
    copilot = copilotFor(name);
    return Response.json({ name, commitId: (await w.orchestrator.mainTree()).commitId, created: true }, { status: 201 });
  };
  const assets = options.assets ?? join(REPO_ROOT, "apps", "dashboard", "dist");
  if (!existsSync(join(assets, "index.html"))) log(`no dashboard build in ${assets}; run pnpm build`);

  const localCloudflare = async (id: string): Promise<CloudflareView> => {
    const record = await w.orchestrator.session(id);
    const name = record.project;
    const box = (sandbox: string): SandboxFacts => ({ name: sandbox, objectId: createHash("sha256").update(sandbox).digest("hex"), running: false, exit: null });
    return cloudflareView({
      accountId: null,
      engine: "chef",
      project: name,
      router: "chef-app",
      projectObject: createHash("sha256").update(name).digest("hex"),
      namespaces: {},
      containerApp: { name: "chef-sessionagent", id: null },
      main: { remote: null, commitId: (await w.orchestrator.mainTree()).commitId },
      session: { id, fork: record.fork, remote: null, removed: record.forkDeleted ? (record.machine.state === "dropped" ? "dropped" : "merged") : null, head: record.head, lanes: (record.lanes ?? []).map((l) => ({ role: l.role, branch: l.branch, head: l.head })) },
      agents: agentsOf(record),
      sandboxes: { session: box(id), lanes: Object.fromEntries((record.lanes ?? []).map((l) => [l.role, box(`${id}--${l.role}`)])), main: null },
      app: { name: `${id}-${name}`, url: record.app?.url ?? null, status: record.app?.status ?? null, commitId: record.app?.commitId ?? null },
      mainApp: null,
    });
  };

  const sessionRequest = async (request: Request, id: string, sub: string | null): Promise<Response> => {
    const body = async () => (request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, string | undefined>) : {});
    try {
      if (request.method === "GET" && sub === null) return Response.json({ record: await w.orchestrator.session(id), budget: DEFAULT_BUDGET });
      if (request.method === "GET" && sub === "turns") return Response.json(await w.orchestrator.turns(id));
      if (request.method === "GET" && sub === "changes") return Response.json(await w.orchestrator.changes(id));
      if (request.method === "GET" && sub === "cloudflare") return Response.json(await localCloudflare(id));
      if (request.method === "POST" && sub === "drop") return Response.json({ state: (await w.orchestrator.drop(id, (await body())["reason"]?.trim() || undefined)).machine.state }, { status: 202 });
      if (request.method === "POST" && sub === "retry") {
        const record = await w.orchestrator.retry(id, (await body())["guidance"] ?? "");
        drive();
        return Response.json({ state: record.machine.state }, { status: 202 });
      }
      if (request.method === "POST" && sub === "merge") {
        const record = await w.orchestrator.approveMerge(id);
        drive();
        return Response.json({ state: record.machine.state }, { status: 202 });
      }
      if (request.method === "POST" && sub === "version") {
        const record = await w.orchestrator.newVersion(id, (await body())["prompt"] ?? null);
        drive();
        return Response.json({ sessionId: record.id, version: record.version ?? null }, { status: 202 });
      }
      if (request.method === "POST" && sub === "steer") {
        const message = (await body())["message"]?.trim();
        if (!message) return Response.json({ error: "message is required" }, { status: 400 });
        await w.orchestrator.steer(id, message);
        return Response.json({ ok: true }, { status: 202 });
      }
    } catch (error) {
      if (error instanceof ControlError) return Response.json({ error: error.message }, { status: 409 });
      if (error instanceof Error && error.message.startsWith("unknown session")) return Response.json({ error: error.message }, { status: 404 });
      throw error;
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };

  const envView = async () => {
    const features = [...readSpec((await w.orchestrator.mainTree()).tree), ...(await w.orchestrator.sessions()).filter((s) => !isTerminal(s.machine.state)).map((s) => s.plan.feature)];
    return viewProjectEnv(env, shared, cipher, envNeeds(features, envNames(mergeEnv(shared, env))));
  };
  const sharedEnvRequest = async (request: Request): Promise<Response> => {
    if (request.method === "GET") return Response.json(await viewEnv(shared, cipher, []));
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const result = await applyEnvUpdate(shared, await request.json().catch(() => null), cipher, Date.now());
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    shared = result.env;
    if ((await w.orchestrator.environmentChanged()).length > 0) drive();
    return Response.json(await viewEnv(shared, cipher, []));
  };
  let projectSettings: Partial<ProjectSettings> = {};
  const projectSettingsRequest = async (request: Request): Promise<Response> => {
    if (request.method === "GET") return Response.json(viewProjectSettings(readProjectSettings(projectSettings)));
    const result = applyProjectUpdate(projectSettings, await request.json().catch(() => null), () => "local-webhook-secret");
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    projectSettings = result.settings;
    return Response.json(viewProjectSettings(readProjectSettings(projectSettings)));
  };
  const envRequest = async (request: Request): Promise<Response> => {
    if (request.method === "GET") return Response.json(await envView());
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const result = await applyEnvUpdate(env, await request.json().catch(() => null), cipher, Date.now());
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    env = result.env;
    if ((await w.orchestrator.environmentChanged()).length > 0) drive();
    return Response.json(await envView());
  };

  let saved: AppSettings = NO_SETTINGS;
  const settings = async (request: Request, env: SettingsEnv): Promise<Response> => {
    if (request.method === "GET") return Response.json(describeSettings(saved, env));
    const result = applyUpdate(saved, await request.json().catch(() => null));
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    saved = result.settings;
    return Response.json(describeSettings(saved, env));
  };

  const guidance: GuidanceHost = { main: () => w.orchestrator.mainTree(), edit: (edit) => w.orchestrator.editGuidance(edit), shared: async () => instructions };
  const sharedInstructions = { get: async () => instructions, put: async (value: SharedInstructions) => void (instructions = value) };

  interface LocalShare {
    readonly shareId: string;
    readonly token: string;
    readonly kind: "session" | "app";
    readonly project: string;
    readonly id: string;
    readonly name: string;
    readonly createdAt: number;
    readonly expiresAt: number | null;
    readonly lastUsedAt: number | null;
  }
  const shares = new Map<string, LocalShare>();
  const sharesRequest = async (request: Request, name: string): Promise<Response> => {
    if (request.method === "GET") return Response.json({ shares: [...shares.values()].filter((share) => share.project === name) });
    const body = (await request.json().catch(() => ({}))) as { kind?: "session" | "app"; id?: string; expiresInDays?: number | null };
    if ((body.kind !== "session" && body.kind !== "app") || !body.id) return Response.json({ error: "say what to share" }, { status: 400 });
    const current = [...shares.values()].find((share) => share.project === name && share.kind === body.kind && share.id === body.id);
    if (current) return Response.json({ share: current, token: current.token });
    const title = (await w.orchestrator.sessions()).find((record) => record.id === body.id)?.plan.feature.title ?? body.id;
    const { id, token } = newToken();
    const now = Date.now();
    const share: LocalShare = { shareId: id, token, kind: body.kind, project: name, id: body.id, name: title, createdAt: now, expiresAt: body.expiresInDays ? now + body.expiresInDays * 86_400_000 : null, lastUsedAt: null };
    shares.set(token, share);
    return Response.json({ share, token }, { status: 201 });
  };
  const sharedTarget = (request: Request): Response => {
    const share = shares.get((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!share) return Response.json({ error: "this API key is not valid" }, { status: 401 });
    return Response.json({ kind: share.kind, project: share.project, id: share.id, name: share.name, expiresAt: share.expiresAt });
  };

  const agentStore = new MemoryStore();
  const agents = new AgentSettings(agentStore);
  const projectAgents = new AgentSettings(agentStore, Date.now, "project/agents/");
  const api = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === "/api/settings" && options.settings) return settings(request, options.settings);
    if (url.pathname === "/api/env") return sharedEnvRequest(request);
    if (url.pathname === "/api/instructions") return sharedInstructionsRequest(request, sharedInstructions);
    if (url.pathname === "/api/agents" || url.pathname === "/api/agents/restore") {
      const resolved = resolveSettings(saved, options.settings ?? {});
      return agentsRequest(request, { store: agents, defaults: repoProfiles(), models: resolved.models, jev: resolved.jev !== null });
    }
    if (url.pathname === "/api/projects") return projects(request);
    if (url.pathname === "/api/share" && request.method === "GET") return sharedTarget(request);
    const shareId = /^\/api\/shares\/([a-z0-9]{12})$/.exec(url.pathname)?.[1];
    if (shareId && request.method === "DELETE") {
      for (const [token, share] of shares) if (share.shareId === shareId) shares.delete(token);
      return new Response(null, { status: 204 });
    }
    const base = project ? `/api/projects/${project.name}` : null;
    if (base && copilot && url.pathname.startsWith(`${base}/copilotkit`)) return copilot(request);
    if (url.pathname.startsWith("/api/")) {
      const action = base && url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length + 1) : null;
      if (request.method === "POST" && action === "prompts") {
        const { prompt } = (await request.json()) as { prompt?: string };
        if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
        return Response.json(await link.submit(prompt.trim()), { status: 202 });
      }
      if (request.method === "POST" && action === "route") {
        const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
        if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
        return Response.json(await w.orchestrator.route(prompt.trim()));
      }
      if (request.method === "GET" && action === "sessions") return Response.json(await w.orchestrator.sessions());
      if (project && action === "shares") return sharesRequest(request, project.name);
      if (action === "settings") return projectSettingsRequest(request);
      if (action === "env") return envRequest(request);
      if (action === "instructions") return instructionsRequest(request, guidance);
      if (action === "memory") return memoryRequest(request, guidance);
      if (project && (action === "agents" || action === "agents/restore")) {
        const resolved = resolveSettings(saved, options.settings ?? {});
        return projectAgentsRequest(request, { project: project.name, store: projectAgents, shared: agents, defaults: repoProfiles(), models: resolved.models, jev: resolved.jev !== null });
      }
      if (request.method === "GET" && action === "spec") {
        const main = await w.orchestrator.mainTree();
        return Response.json({ commitId: main.commitId, features: readSpec(main.tree), map: readFeatureMap(main.tree), layout: await w.orchestrator.layout() });
      }
      const featureMap = FEATURE_MAP_ROUTE.exec(url.pathname);
      if (featureMap) return (await featureMapRequest(request, w.orchestrator, Boolean(featureMap[1]))).response;
      const sessionHistory = SESSION_HISTORY_ROUTE.exec(url.pathname);
      if (sessionHistory && request.method === "GET") return sessionHistoryResponse(w.orchestrator, sessionHistory[1] as string, sessionHistory[2] ?? null);
      const history = HISTORY_ROUTE.exec(url.pathname);
      if (history && request.method === "GET") return historyResponse(w.orchestrator, history[1] ?? null, url.searchParams.get("limit"));
      const feature = FEATURE_ROUTE.exec(url.pathname);
      if (feature) return (await featureRequest(request, w.orchestrator, feature[1] as string)).response;
      const session = action ? /^sessions\/([a-z0-9-]{1,40})(?:\/([a-z]+))?$/.exec(action) : null;
      if (session) return sessionRequest(request, session[1] as string, session[2] ?? null);
      if (request.method === "GET" && action === "events") return Response.json(await link.events(Number(url.searchParams.get("after") ?? 0)));
      if (request.method === "GET" && action === "cursor") return Response.json({ seq: await link.cursor() });
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const path = normalize(url.pathname === "/" || url.pathname === "/s" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(assets, path);
    if (!file.startsWith(assets) || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
    return new Response(readFileSync(file), { headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream" } });
  };

  const server = createServer(createNodeFetchHandler(api));
  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
