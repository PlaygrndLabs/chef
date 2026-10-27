import { Agent } from "agents";
import { WorkerEntrypoint } from "cloudflare:workers";
import { APP_START_SECONDS, sandboxMicros, type AppStatus, type CoderEvent, type CoderTurnResult, type CustomAgent, type FileChanges, type TurnGuard, type TurnResume } from "@chef/core";
import { APP_REQUEST_HEADER } from "@chef/adapters/app-gate";
import { appPage } from "@chef/adapters/app-page";
import { layerStore } from "./image-layers.ts";
import { LAYER_CACHE_ADDRESS, layerCacheFetch } from "./layer-cache.ts";
import { TRANSCRIPT_ADDRESS, transcriptFetch } from "./transcripts.ts";
import { UPLOADS_ADDRESS, uploadFetch } from "./uploads.ts";
import { WORKER_APP, assetPath, assetResponse, dropWorkerApp, saveWorkerApp, workerCode, type WorkerAppMeta, type WorkerBundle } from "./worker-app.ts";
import { busySeconds, exitedForMemory, nextStep, oomKills, sandboxSize, sizeLabel, sizeStep } from "./sandbox-size.ts";

export const PLACEHOLDER = "chef-placeholder";

export interface SandboxJob {
  readonly sessionId: string;
  readonly project: string;
  readonly featureId: string;
  readonly role: string;
  readonly model: string;
  readonly prompt: string;
  readonly agent: CustomAgent;
  readonly writeScope: readonly string[];
  readonly guard?: TurnGuard;
  readonly remote: string;
  readonly ref: string;
  readonly commitId: string;
  readonly readToken: string;
  readonly llm: { readonly baseUrl: string };
  readonly turnId?: string;
  readonly ownStructure?: boolean;
  readonly lane?: string;
  readonly resume?: TurnResume;
}

export type TurnOutcome = { readonly status: "done"; readonly result: CoderTurnResult } | { readonly status: "running" } | { readonly status: "lost" };

export interface OutboundAccess {
  readonly artifactsHost: string;
  readonly readToken: string;
  readonly llmHost: string | null;
  readonly llmKey: string | null;
  readonly cacheScope: string;
  readonly project: string | null;
}

interface OutboundProps {
  readonly sandbox: string;
}

type AccessStub = { outboundAccess(): Promise<OutboundAccess | null> };

export class SandboxOutbound extends WorkerEntrypoint<Env, OutboundProps> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessions = this.env.SESSION;
    const access = await (sessions.get(sessions.idFromName(this.ctx.props.sandbox)) as unknown as AccessStub).outboundAccess();
    if (!access) return new Response("this sandbox has no access to anything yet", { status: 503 });
    if (url.hostname === TRANSCRIPT_ADDRESS) return this.env.TRANSCRIPTS && access.project ? transcriptFetch(request, this.env.TRANSCRIPTS, access.project) : new Response("this Chef keeps no transcripts", { status: 404 });
    if (url.hostname === UPLOADS_ADDRESS) return this.env.TRANSCRIPTS && access.project ? uploadFetch(request, this.env.TRANSCRIPTS, access.project) : new Response("this Chef keeps no uploads", { status: 404 });
    if (url.hostname === LAYER_CACHE_ADDRESS) return layerCacheFetch(request, layerStore(this.env.IMAGE_LAYERS), access.cacheScope);
    if (url.protocol !== "https:") return new Response("https only", { status: 403 });
    const headers = new Headers(request.headers);
    if (url.hostname === access.artifactsHost) {
      if (url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack") return new Response("the coder sandbox cannot push", { status: 403 });
      headers.set("authorization", `Bearer ${access.readToken}`);
    } else if (url.hostname === access.llmHost && access.llmKey) {
      const llmKey = access.llmKey;
      for (const name of ["x-api-key", "authorization"]) {
        const current = headers.get(name);
        if (current?.includes(PLACEHOLDER)) headers.set(name, current.replace(PLACEHOLDER, llmKey));
      }
    }
    return fetch(new Request(request, { headers }));
  }
}

interface ObjectsProps {
  readonly sandbox: string;
}

type ObjectsHost = {
  objectFetch(binding: string, name: string, request: Request): Promise<Response>;
  objectCall(binding: string, name: string, method: string, args: unknown[]): Promise<unknown>;
};

export class AppObjects extends WorkerEntrypoint<Env, ObjectsProps> {
  private host(): ObjectsHost {
    return this.env.SESSION.get(this.env.SESSION.idFromName(this.ctx.props.sandbox)) as unknown as ObjectsHost;
  }

  fetchObject(binding: string, name: string, request: Request): Promise<Response> {
    return this.host().objectFetch(binding, name, request);
  }

  callObject(binding: string, name: string, method: string, args: unknown[]): Promise<unknown> {
    return this.host().objectCall(binding, name, method, args);
  }
}

export interface ChecksJob {
  readonly sessionId: string;
  readonly project: string;
  readonly remote: string;
  readonly ref: string;
  readonly commitId: string;
  readonly readToken: string;
  readonly commands: readonly { name: string; argv: readonly string[]; timeoutMs?: number; env?: Readonly<Record<string, string>> }[];
  readonly overlay?: FileChanges;
  readonly install?: { readonly argv: readonly string[]; readonly key: string; readonly timeoutMs?: number; readonly env?: Readonly<Record<string, string>> };
}

export interface AppJob {
  readonly target: string;
  readonly project: string;
  readonly remote: string;
  readonly ref: string;
  readonly commitId: string;
  readonly env: Readonly<Record<string, string>>;
  readonly idleMinutes: number;
  readonly startSeconds?: number;
  readonly bundle?: boolean;
}

export interface AppState {
  readonly status: AppStatus | "asleep";
  readonly target: string;
  readonly project: string;
  readonly commitId: string;
  readonly port: number | null;
  readonly error?: string;
  readonly idleMinutes: number;
  readonly at: number;
  readonly via?: "worker";
}

export interface CommandResult {
  readonly name: string;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms?: number;
}

interface TurnOutput {
  readonly changes: FileChanges;
  readonly summary: string;
  readonly model: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedInputTokens?: number };
}

export type SandboxRestart = "restarted" | "waiting" | "sleeping";

export interface SandboxStatus {
  readonly running: boolean;
  readonly exit: string | null;
  readonly size?: string | null;
}

export const SANDBOX_IDLE_SECONDS = 120;
export const INACTIVITY_BACKSTOP_SECONDS = 300;
export const FOLLOW_SECONDS = 60;

const LAST_USED = "sandbox/last-used";
const LAST_VISIT = "sandbox/last-visit";
const OWNER = "sandbox/project";
const SIZE = "sandbox/size";
const RUNNING_SIZE = "sandbox/running-size";
const OOM_BASE = "sandbox/oom-base";
const RESTART = "sandbox/restart";
const RUN = "sandbox/run";
const CPU_STAT = "head -n 1 /proc/stat";
const RESET_CHECK_MS = 30_000;
const RESTART_GRACE_MS = 5 * 60_000;
const APP = "sandbox/app";
const VISIT_NOTE_MS = 30_000;
const PAGE_ANSWER_MS = 30_000;
const WORKER_FACETS = "worker-app-facets";
const APP_GRACE_MS = 60_000;
const DIAGNOSE_MS = 20_000;
const TURN = "sandbox/turn";
const TURNS_DIR = "/workspace/turns";

type Outbound = Omit<OutboundAccess, "llmKey" | "project">;

type SizeStub = { sandboxStep(): Promise<number>; sandboxNeeds(step: number): Promise<void>; sandboxSpent(sandbox: string, micros: number, seconds: number): Promise<void> };

interface Alive {
  readonly run: number;
  readonly since: number;
  readonly step: number;
  readonly cpu: number | null;
}

function cacheScope(remote: string): string {
  const url = new URL(remote);
  return `${url.host}${url.pathname}`;
}

interface TurnState {
  readonly id: string;
  readonly key?: string;
  readonly dir: string;
  readonly model: string;
  readonly outbound: Outbound;
  delivered: number;
  result: TurnOutput | null;
  done: boolean;
}

export class SessionAgent extends Agent<Env> {
  private exit: string | null = null;
  private busy = 0;
  private readonly grants = new Map<number, Outbound>();
  private granted = 0;
  private lastGrant: Outbound | null = null;
  private llmHost: string | null = null;
  private llmKey: string | null = null;
  private readonly intercepted = new Set<string>();
  private intercepting: Promise<void> = Promise.resolve();
  private visited = 0;
  private appRun: { readonly commitId: string; readonly run: Promise<AppState> } | null = null;
  private appsStarting = 0;
  private checksTail: Promise<unknown> = Promise.resolve();
  private project: string | null = null;
  private starting: Promise<Container> | null = null;

  async status(): Promise<SandboxStatus> {
    const running = this.ctx.container?.running ?? false;
    if (running) await this.settle(false).catch((error: unknown) => console.error(`counting the time of sandbox ${this.name} failed`, error));
    return { running, exit: this.exit, size: running ? sizeLabel(sandboxSize(await this.ctx.storage.get<number>(RUNNING_SIZE))) : null };
  }

  async stop(): Promise<boolean> {
    const container = this.ctx.container;
    if (!container?.running || this.busy > 0) return false;
    await container.destroy();
    return true;
  }

  async reset(lane?: string): Promise<void> {
    const container = this.ctx.container;
    if (!container?.running) return;
    const key = turnKey(lane);
    if ((await within(RESET_CHECK_MS, this.turnAlive(key))) === true && (await within(RESET_CHECK_MS, this.stopTurn(key).then(() => true)))) {
      await this.ctx.storage.put(RESTART, Date.now());
      await this.schedule(60, "restartIfIdle", undefined, { idempotent: true });
      return;
    }
    await container.destroy().catch(() => undefined);
  }

  async restart(now: boolean): Promise<SandboxRestart> {
    const container = this.ctx.container;
    if (!container?.running) return "sleeping";
    if (!now && (await within(RESET_CHECK_MS, this.turnAlive())) === true) {
      await this.ctx.storage.put(RESTART, Date.now());
      await this.schedule(60, "restartIfIdle", undefined, { idempotent: true });
      return "waiting";
    }
    await container.destroy().catch(() => undefined);
    return "restarted";
  }

  async discard(): Promise<void> {
    const container = this.ctx.container;
    if (container?.running) {
      await this.settle(true, await this.cpuNow()).catch(() => undefined);
      await container.destroy().catch(() => undefined);
    }
    await this.destroy();
  }

  async sleepIfIdle(): Promise<void> {
    const container = this.ctx.container;
    if (!container?.running) return;
    const sleepAt = await this.sleepAt(0);
    await this.settle(false, await this.cpuNow()).catch((error: unknown) => console.error(`counting the time of sandbox ${this.name} failed`, error));
    if (this.busy === 0 && Date.now() >= sleepAt && !(await this.turnAlive())) {
      await container.destroy();
      return;
    }
    await this.schedule(Math.max(30, Math.ceil((sleepAt - Date.now()) / 1000)), "sleepIfIdle");
  }

  async outboundAccess(): Promise<OutboundAccess | null> {
    const latest = [...this.grants.values()].at(-1) ?? this.lastGrant;
    if (!latest) return null;
    this.project ??= (await this.ctx.storage.get<string>(OWNER)) ?? null;
    return { ...latest, llmHost: this.llmHost, llmKey: this.llmKey, project: this.project };
  }

  async runTurn(job: SandboxJob, onEvent: (event: CoderEvent) => void, llmKey: string): Promise<TurnOutcome> {
    await this.remember(job.project);
    const id = job.turnId ?? `${job.sessionId}-${Date.now()}`;
    this.llmKey = llmKey;
    const release = this.grant({ artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, llmHost: new URL(job.llm.baseUrl).hostname, cacheScope: cacheScope(job.remote) });
    try {
      let turn = await this.ctx.storage.get<TurnState>(turnKey(job.lane));
      if (turn?.id !== id) turn = await this.launch(id, job);
      return await this.follow(turn, onEvent, job.turnId ? FOLLOW_SECONDS : null);
    } finally {
      release();
    }
  }

  async resumeTurn(id: string, onEvent: (event: CoderEvent) => void, llmKey: string, lane?: string): Promise<TurnOutcome> {
    const turn = await this.ctx.storage.get<TurnState>(turnKey(lane));
    if (turn?.id !== id) return { status: "lost" };
    this.llmKey = llmKey;
    const release = this.grant(turn.outbound);
    try {
      return await this.follow(turn, onEvent, FOLLOW_SECONDS);
    } finally {
      release();
    }
  }

  private async launch(id: string, job: SandboxJob): Promise<TurnState> {
    const key = turnKey(job.lane);
    await this.stopTurn(key);
    await this.ensureContainer();
    const outbound: Outbound = { artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, llmHost: new URL(job.llm.baseUrl).hostname, cacheScope: cacheScope(job.remote) };
    await this.intercept(outbound);
    const laneDir = `${TURNS_DIR}/${job.lane ?? "main"}`;
    const turn: TurnState = { id, key, dir: `${laneDir}/${id}`, model: job.model, outbound, delivered: 0, result: null, done: false };
    const { readToken, turnId, lane, ...visible } = job;
    void readToken;
    void turnId;
    void lane;
    const transcripts = this.env.TRANSCRIPTS ? { transcripts: `http://${TRANSCRIPT_ADDRESS}/${job.sessionId}/` } : {};
    const started = await this.shell(LAUNCH, { DIR: turn.dir, LANE: laneDir, SCRIPT: "runner.mjs", CHEF_JOB: toBase64(JSON.stringify({ ...visible, ...transcripts })) });
    if (started.code !== 0) throw new Error(`the coder runner did not start: ${started.out.slice(-500)}`);
    await this.ctx.storage.put(key, turn);
    return turn;
  }

  private async follow(turn: TurnState, onEvent: (event: CoderEvent) => void, seconds: number | null): Promise<TurnOutcome> {
    if (turn.done && turn.result) return { status: "done", result: turnResult(turn) };
    if (!this.ctx.container?.running) return { status: "lost" };
    await this.intercept(turn.outbound);
    this.busy++;
    try {
      const deadline = seconds === null ? Infinity : Date.now() + seconds * 1000;
      for (;;) {
        const wait = Math.max(1, Math.min(FOLLOW_SECONDS, Math.ceil((deadline - Date.now()) / 1000)));
        await this.tail(turn, wait, onEvent);
        const state = (await this.shell(STATE, { DIR: turn.dir })).out.trim();
        if (state === "lost") {
          await this.tail(turn, 1, onEvent);
          return turn.result ? this.finish(turn, onEvent, 0) : { status: "lost" };
        }
        if (state !== "running") {
          await this.tail(turn, 1, onEvent);
          return this.finish(turn, onEvent, Number(state));
        }
        if (Date.now() >= deadline) return { status: "running" };
      }
    } finally {
      this.busy--;
      await this.ctx.storage.put(turn.key ?? TURN, turn);
      await this.ctx.storage.put(LAST_USED, Date.now());
      await this.scheduleSleep();
      await this.checkMemory(`the coder turn ${turn.id}`);
    }
  }

  private async finish(turn: TurnState, onEvent: (event: CoderEvent) => void, code: number): Promise<TurnOutcome> {
    turn.done = true;
    if (code === 0 && turn.result) return { status: "done", result: turnResult(turn) };
    const tail = (await this.shell(STDERR, { DIR: turn.dir })).out;
    onEvent({ type: "session.error", message: tail || `runner exited with ${code}` });
    throw new Error(`coder runner failed with exit code ${code}: ${tail.slice(-500)}`);
  }

  private async tail(turn: TurnState, seconds: number, onEvent: (event: CoderEvent) => void): Promise<void> {
    const container = this.ctx.container;
    if (!container) return;
    const process = await container.exec(["sh", "-c", FOLLOW], { env: { ...SANDBOX_ENV, DIR: turn.dir, FROM: String(turn.delivered + 1), WAIT: String(seconds) }, user: SANDBOX_USER, stdout: "pipe", stderr: "ignore" });
    const lines = (process.stdout as ReadableStream<Uint8Array>).pipeThrough(new TextDecoderStream()).pipeThrough(splitLines(false));
    let saved = Date.now();
    for await (const line of lines) {
      turn.delivered++;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event["type"] === "chef.result") turn.result = event as unknown as TurnOutput;
        else onEvent(event as unknown as CoderEvent);
      } catch {
        continue;
      }
      if (Date.now() - saved > 2000) {
        saved = Date.now();
        await this.ctx.storage.put(turn.key ?? TURN, turn);
      }
    }
    await process.exitCode;
  }

  private async turnAlive(except?: string): Promise<boolean> {
    for (const [key, turn] of await this.ctx.storage.list<TurnState>({ prefix: TURN })) {
      if (turn.done || key === except) continue;
      if ((await this.shell(STATE, { DIR: turn.dir }).catch(() => ({ code: 1, out: "lost" }))).out.trim() === "running") return true;
    }
    return false;
  }

  private async stopTurn(key: string): Promise<void> {
    const turn = await this.ctx.storage.get<TurnState>(key);
    await this.ctx.storage.delete(key);
    if (!turn || turn.done || !this.ctx.container?.running) return;
    await this.shell(KILL, { DIR: turn.dir }).catch(() => undefined);
  }

  private async shell(script: string, env: Record<string, string>): Promise<{ code: number; out: string }> {
    const container = this.ctx.container;
    if (!container) throw new Error("the SessionAgent container is not configured");
    const process = await container.exec(["sh", "-c", script], { env: { ...SANDBOX_ENV, ...env }, user: SANDBOX_USER, stdout: "pipe", stderr: "combined" });
    const out = await new Response(process.stdout as ReadableStream<Uint8Array>).text();
    return { code: await process.exitCode, out };
  }

  async runChecks(job: ChecksJob): Promise<CommandResult[]> {
    const run = this.checksTail.then(() => this.checksNow(job));
    this.checksTail = run.catch(() => undefined);
    return run;
  }

  private async checksNow(job: ChecksJob): Promise<CommandResult[]> {
    await this.remember(job.project);
    let results: CommandResult[] | null = null;
    const { code, tail } = await this.runScript("checks.mjs", job, (event) => {
      if (event["type"] === "chef.checks") results = event["results"] as CommandResult[];
    });
    if (!results) throw new Error(`checks runner failed with exit code ${code}: ${tail.slice(-500)}`);
    return results;
  }

  async runApp(job: AppJob, readToken: string): Promise<AppState> {
    await this.remember(job.project);
    const current = this.appRun;
    if (current?.commitId === job.commitId) return current.run;
    const before = current ? current.run.catch(() => undefined) : Promise.resolve();
    const entry: { readonly commitId: string; readonly run: Promise<AppState> } = {
      commitId: job.commitId,
      run: before
        .then(async (): Promise<AppState> => (this.appRun === entry ? this.startApp(job, readToken) : ((await this.ctx.storage.get<AppState>(APP)) ?? this.startApp(job, readToken))))
        .finally(() => {
          if (this.appRun === entry) this.appRun = null;
        }),
    };
    this.appRun = entry;
    return entry.run;
  }

  private async startApp(job: AppJob, readToken: string): Promise<AppState> {
    const alone = this.appsStarting++ === 0;
    try {
      let state: AppState = { status: "starting", target: job.target, project: job.project, commitId: job.commitId, port: null, idleMinutes: job.idleMinutes, at: Date.now() };
      await this.ctx.storage.put(APP, state);
      if (alone && this.ctx.container?.running) await this.shell(STOP_APP, {}).catch(() => undefined);
      const startSeconds = job.startSeconds ?? APP_START_SECONDS;
      const script = { ...job, bundle: job.bundle === true && this.env.LOADER !== undefined, startSeconds, readToken };
      const files = { modules: new Map<string, Uint8Array>(), assets: new Map<string, Uint8Array>() };
      let bundle: WorkerBundle | null = null;
      const { code, tail, stopped } = await this.runScript(
        "app.mjs",
        script,
        (event) => {
          if (event["type"] === "chef.bundle" && typeof event["path"] === "string" && typeof event["data"] === "string") {
            (event["kind"] === "module" ? files.modules : files.assets).set(event["path"], fromBase64(event["data"]));
            return;
          }
          if (event["type"] !== "chef.app") return;
          if (event["status"] === "bundled") {
            bundle = event["bundle"] as WorkerBundle;
            return;
          }
          const status = event["status"] as AppStatus;
          const port = typeof event["port"] === "number" ? event["port"] : null;
          state = { ...state, status, port, at: Date.now(), ...(typeof event["error"] === "string" ? { error: event["error"] } : {}) };
          void this.ctx.storage.put(APP, state);
        },
        {},
        startSeconds * 1000 + APP_GRACE_MS,
      );
      if (bundle) state = await this.keepWorkerApp(state, job, bundle, files);
      else if (state.status !== "starting" && (await this.ctx.storage.get(WORKER_APP))) await dropWorkerApp(this.ctx.storage);
      if (state.status === "starting") state = { ...state, status: "failed", error: stopped ? await this.stuckApp(job, startSeconds) : `the app runner stopped with exit code ${code}${this.exit ? ` (the sandbox stopped: ${this.exit})` : ""}: ${tail.slice(-500) || "no output"}`, at: Date.now() };
      await this.ctx.storage.put(APP, state);
      if (state.status === "running" && state.via !== "worker") await this.ctx.container?.setInactivityTimeout((await this.backstopSeconds()) * 1000).catch(() => undefined);
      return state;
    } finally {
      this.appsStarting--;
    }
  }

  private async stuckApp(job: AppJob, startSeconds: number): Promise<string> {
    const minutes = Math.round(startSeconds / 60);
    const diagnosis = this.ctx.container?.running ? this.shell(`${STOP_APP}\n${APP_LOGS}`, { PROJECT: job.project, FILE: `/workspace/${job.target}/compose.chef.json`, LOG: `/workspace/${job.target}/app.log` }).catch(() => ({ code: 1, out: "" })) : Promise.resolve({ code: 1, out: "" });
    const logs = await Promise.race([diagnosis, new Promise<{ code: number; out: string }>((resolve) => setTimeout(() => resolve({ code: 1, out: "" }), DIAGNOSE_MS))]);
    return `the app did not start within ${minutes} minutes, so Chef stopped it${this.exit ? ` (the sandbox stopped: ${this.exit})` : ""}: ${logs.out.trim().slice(-3000) || "no output"}`;
  }

  private async keepWorkerApp(state: AppState, job: AppJob, bundle: WorkerBundle, files: { readonly modules: Map<string, Uint8Array>; readonly assets: Map<string, Uint8Array> }): Promise<AppState> {
    try {
      await saveWorkerApp(this.ctx.storage, { commitId: job.commitId, env: job.env, bundle, files });
      for (const name of (await this.ctx.storage.get<string[]>(WORKER_FACETS)) ?? []) this.ctx.facets.abort(name, "main has a new build");
      return { ...state, status: "running", port: null, via: "worker", at: Date.now() };
    } catch (error) {
      return { ...state, status: "failed", port: null, error: `keeping the built app failed: ${error instanceof Error ? error.message : String(error)}`, at: Date.now() };
    }
  }

  private workerStub(meta: WorkerAppMeta): WorkerStub {
    const loader = this.env.LOADER;
    if (!loader) throw new Error("this Chef has no Worker Loader binding");
    const objects = (this.ctx.exports as unknown as Record<string, (options: { props: { sandbox: string } }) => Fetcher>)["AppObjects"];
    if (!objects) throw new Error("this Chef does not export AppObjects");
    return loader.get(meta.codeId, () => workerCode(this.ctx.storage, meta, objects({ props: { sandbox: this.name } })));
  }

  private async workerApp(request: Request, url: URL, state: AppState, html: boolean): Promise<Response> {
    const meta = await this.ctx.storage.get<WorkerAppMeta>(WORKER_APP);
    if (!meta || meta.commitId !== state.commitId) {
      this.ctx.waitUntil(this.wake(state));
      return appPage({ status: "starting", target: state.target, html, path: url.pathname });
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const path = assetPath(meta, url.pathname, request.method === "GET" && html);
      if (path) return assetResponse(this.ctx.storage, meta, path, request);
    }
    const headers = new Headers(request.headers);
    headers.delete(APP_REQUEST_HEADER);
    try {
      return await this.workerStub(meta).getEntrypoint().fetch(new Request(request, { headers }));
    } catch (error) {
      return appPage({ status: "down", target: state.target, html, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async facet(binding: string, name: string): Promise<Fetcher> {
    const meta = await this.ctx.storage.get<WorkerAppMeta>(WORKER_APP);
    const object = meta?.objects.find((o) => o.binding === binding);
    if (!meta || !object) throw new Error(`this app has no Durable Object binding ${binding}`);
    const facet = `${binding}:${name}`;
    const known = (await this.ctx.storage.get<string[]>(WORKER_FACETS)) ?? [];
    if (!known.includes(facet)) await this.ctx.storage.put(WORKER_FACETS, [...known, facet]);
    return this.ctx.facets.get(facet, () => ({ class: this.workerStub(meta).getDurableObjectClass(object.className) }));
  }

  async objectFetch(binding: string, name: string, request: Request): Promise<Response> {
    return (await this.facet(binding, name)).fetch(request);
  }

  async objectCall(binding: string, name: string, method: string, args: unknown[]): Promise<unknown> {
    const facet = (await this.facet(binding, name)) as unknown as Record<string, unknown>;
    const call = facet[method];
    if (typeof call !== "function") throw new Error(`${binding} has no method ${method}`);
    return (call as (...input: unknown[]) => Promise<unknown>).apply(facet, args);
  }

  async appState(): Promise<AppState | null> {
    const state = (await this.ctx.storage.get<AppState>(APP)) ?? null;
    if (state?.via === "worker") return state;
    if (state?.status === "starting" && this.appsStarting === 0) return { ...state, status: "asleep" };
    if (!state || this.ctx.container?.running) return state;
    return state.status === "running" || state.status === "starting" ? { ...state, status: "asleep" } : state;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get(APP_REQUEST_HEADER) !== "1") return super.fetch(request);
    const state = await this.appState();
    const container = this.ctx.container;
    const html = (request.headers.get("accept") ?? "").includes("text/html");
    const url = new URL(request.url);
    if (state?.via === "worker" && state.status === "running") return this.workerApp(request, url, state, html);
    if (!container?.running || state?.status !== "running" || !state.port) {
      const moved = html && state && (state.status === "asleep" || state.status === "running") ? await this.movedTo(state, url) : null;
      if (moved) return new Response(null, { status: 302, headers: { location: moved, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      if (state && (state.status === "asleep" || state.status === "running")) this.ctx.waitUntil(this.wake(state));
      if (state?.status === "failed") return appPage({ status: "failed", target: state.target, html, ...(state.error ? { error: state.error } : {}) });
      if (state?.status === "no-stack") return appPage({ status: "no-stack", target: state.target, html });
      return appPage({ status: state ? "starting" : "missing", target: state?.target ?? this.name, html, path: url.pathname, ...(state?.status === "starting" ? { since: state.at } : {}) });
    }
    if (Date.now() - this.visited > VISIT_NOTE_MS) {
      this.visited = Date.now();
      await this.ctx.storage.put(LAST_VISIT, this.visited);
      await this.scheduleSleep();
    }
    const headers = new Headers(request.headers);
    headers.delete(APP_REQUEST_HEADER);
    try {
      const answer = container.getTcpPort(state.port).fetch(new Request(`http://localhost:${state.port}${url.pathname}${url.search}`, new Request(request, { headers })));
      if (!html || request.method !== "GET") return await answer;
      const page = await Promise.race([answer, new Promise<null>((resolve) => setTimeout(() => resolve(null), PAGE_ANSWER_MS))]);
      return page ?? appPage({ status: "down", target: state.target, html, error: `the app did not answer ${url.pathname} within ${PAGE_ANSWER_MS / 1000} seconds` });
    } catch (error) {
      return appPage({ status: "down", target: state.target, html, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async movedTo(state: AppState, url: URL): Promise<string | null> {
    const project = this.env.PROJECT.get(this.env.PROJECT.idFromName(state.project)) as unknown as { movedApp(target: string, path: string): Promise<string | null> };
    return project.movedApp(state.target, `${url.pathname}${url.search}`).catch((error: unknown) => {
      console.error(`finding where the app of ${state.target} went failed`, error);
      return null;
    });
  }

  private async wake(state: AppState): Promise<void> {
    await (this.env.PROJECT.get(this.env.PROJECT.idFromName(state.project)) as unknown as { wakeApp(target: string): Promise<void> }).wakeApp(state.target).catch((error: unknown) => console.error(`waking the app of ${state.target} failed`, error));
  }

  private stopped(exit: string, run: number): void {
    this.exit = exit;
    this.ctx.waitUntil(this.settle(true, null, run).catch((error: unknown) => console.error(`counting the time of sandbox ${this.name} failed`, error)));
  }

  private async cpuNow(): Promise<number | null> {
    if (!this.ctx.container?.running) return null;
    return busySeconds((await this.shell(CPU_STAT, {}).catch(() => ({ code: 1, out: "" }))).out);
  }

  private async settle(stopped: boolean, cpu: number | null = null, run?: number): Promise<void> {
    const alive = await this.ctx.storage.get<Alive>(RUN);
    if (!alive || (run !== undefined && alive.run !== run)) return;
    const now = Date.now();
    const cpuSeconds = cpu !== null && alive.cpu !== null ? Math.max(0, cpu - alive.cpu) : 0;
    if (stopped) await this.ctx.storage.delete(RUN);
    else await this.ctx.storage.put(RUN, { ...alive, since: now, cpu: cpu ?? alive.cpu } satisfies Alive);
    await this.report(alive.step, (now - alive.since) / 1000, cpuSeconds);
  }

  private async closeStale(): Promise<void> {
    const alive = await this.ctx.storage.get<Alive>(RUN);
    if (!alive) return;
    const end = Math.min(Date.now(), Math.max(alive.since, await this.sleepAt(alive.since)));
    await this.ctx.storage.delete(RUN);
    await this.report(alive.step, (end - alive.since) / 1000, 0);
  }

  private async report(step: number, seconds: number, cpuSeconds: number): Promise<void> {
    const size = sandboxSize(step);
    const micros = sandboxMicros({ memoryMib: size.memoryMib, diskMb: size.diskMb, seconds, cpuSeconds });
    if (micros <= 0) return;
    await (await this.owner())?.sandboxSpent(this.name, micros, Math.max(0, seconds));
  }

  private async sleepAt(since: number): Promise<number> {
    const lastUsed = (await this.ctx.storage.get<number>(LAST_USED)) ?? since;
    const app = await this.ctx.storage.get<AppState>(APP);
    const lastVisit = app?.status === "running" ? await this.ctx.storage.get<number>(LAST_VISIT) : undefined;
    return Math.max(lastUsed + SANDBOX_IDLE_SECONDS * 1000, lastVisit !== undefined && app ? lastVisit + app.idleMinutes * 60_000 : 0);
  }

  private async backstopSeconds(): Promise<number> {
    const app = await this.ctx.storage.get<AppState>(APP);
    return Math.max(INACTIVITY_BACKSTOP_SECONDS, app?.status === "running" ? app.idleMinutes * 60 : 0);
  }

  private async scheduleSleep(): Promise<void> {
    await this.schedule(Math.max(30, Math.ceil(((await this.sleepAt(Date.now())) - Date.now()) / 1000)), "sleepIfIdle", undefined, { idempotent: true });
  }

  private async runScript(script: string, job: { remote: string; readToken: string; llm?: { readonly baseUrl: string } }, onEvent: (event: Record<string, unknown>) => void, secrets: { readonly llmKey?: string | null } = {}, limitMs?: number): Promise<{ code: number; tail: string; stopped: boolean }> {
    this.busy++;
    try {
      return await this.exec(script, job, onEvent, secrets, limitMs);
    } finally {
      this.busy--;
      await this.ctx.storage.put(LAST_USED, Date.now());
      await this.scheduleSleep();
      await this.checkMemory(script);
    }
  }

  private async exec(script: string, job: { remote: string; readToken: string; llm?: { readonly baseUrl: string } }, onEvent: (event: Record<string, unknown>) => void, secrets: { readonly llmKey?: string | null }, limitMs?: number): Promise<{ code: number; tail: string; stopped: boolean }> {
    const container = await this.ensureContainer();
    const outbound: Outbound = { artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, llmHost: job.llm ? new URL(job.llm.baseUrl).hostname : null, cacheScope: cacheScope(job.remote) };
    if (secrets.llmKey) this.llmKey = secrets.llmKey;
    const release = this.grant(outbound);
    try {
      await this.intercept(outbound);
      return await this.execGranted(container, script, job, onEvent, limitMs);
    } finally {
      release();
    }
  }

  private async execGranted(container: Container, script: string, job: { remote: string; readToken: string; llm?: { readonly baseUrl: string } }, onEvent: (event: Record<string, unknown>) => void, limitMs?: number): Promise<{ code: number; tail: string; stopped: boolean }> {
    const { readToken, ...visible } = job;
    void readToken;
    const process = await container.exec(["node", `/opt/chef/${script}`], { env: { ...SANDBOX_ENV, CHEF_JOB: toBase64(JSON.stringify(visible)) }, user: SANDBOX_USER, stdout: "pipe", stderr: "combined" }).catch((error: unknown) => {
      throw new Error(`${String(error)} (the sandbox container stopped: ${this.exit ?? "no reason reported"})`);
    });
    const reader = (process.stdout as ReadableStream<Uint8Array>).pipeThrough(new TextDecoderStream()).pipeThrough(splitLines(true)).getReader();
    let stopped = false;
    const timer = limitMs === undefined ? null : setTimeout(() => {
      stopped = true;
      void reader.cancel().catch(() => undefined);
    }, limitMs);
    let tail = "";
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        try {
          onEvent(JSON.parse(next.value) as Record<string, unknown>);
        } catch {
          tail = `${tail}${next.value}\n`.slice(-4000);
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (stopped) return { code: 143, tail, stopped };
    return { code: await process.exitCode, tail, stopped };
  }

  private async remember(project: string): Promise<void> {
    if (this.project === project) return;
    this.project = project;
    await this.ctx.storage.put(OWNER, project);
  }

  private async owner(): Promise<SizeStub | null> {
    this.project ??= (await this.ctx.storage.get<string>(OWNER)) ?? null;
    return this.project ? (this.env.PROJECT.get(this.env.PROJECT.idFromName(this.project)) as unknown as SizeStub) : null;
  }

  private async startStep(): Promise<number> {
    const own = (await this.ctx.storage.get<number>(SIZE)) ?? 0;
    const project = await (await this.owner())?.sandboxStep().catch(() => 0);
    return sizeStep(Math.max(own, project ?? 0));
  }

  private async checkMemory(job: string): Promise<void> {
    try {
      const container = this.ctx.container;
      if (!container?.running) {
        if (exitedForMemory(this.exit)) await this.grow(job);
        return;
      }
      const base = await this.ctx.storage.get<number>(OOM_BASE);
      const kills = oomKills((await this.shell(VMSTAT, {})).out);
      if (base !== undefined && kills !== null && kills > base) {
        await this.grow(job);
        await this.ctx.storage.put(OOM_BASE, kills);
      }
      await this.restartWhenIdle();
    } catch (error) {
      console.error(`checking the memory of sandbox ${this.name} failed`, error);
    }
  }

  async restartIfIdle(): Promise<void> {
    if (await this.restartWhenIdle()) await this.schedule(60, "restartIfIdle");
  }

  private async restartWhenIdle(): Promise<boolean> {
    const container = this.ctx.container;
    if (!container?.running) return false;
    const asked = await this.ctx.storage.get<number>(RESTART);
    const grown = ((await this.ctx.storage.get<number>(SIZE)) ?? 0) > sizeStep(await this.ctx.storage.get<number>(RUNNING_SIZE));
    if (asked === undefined && !grown) return false;
    const quiet = this.busy === 0 || (asked !== undefined && Date.now() - asked > RESTART_GRACE_MS);
    if (quiet && !(await this.turnAlive())) {
      await container.destroy();
      return false;
    }
    return asked !== undefined;
  }

  private async grow(job: string): Promise<void> {
    const running = sizeStep(await this.ctx.storage.get<number>(RUNNING_SIZE));
    const next = nextStep(running);
    if (next === null) return;
    if (((await this.ctx.storage.get<number>(SIZE)) ?? 0) < next) await this.ctx.storage.put(SIZE, next);
    await (await this.owner())?.sandboxNeeds(next).catch((error: unknown) => console.error(`saving the sandbox size of ${this.project} failed`, error));
    console.error(`sandbox ${this.name} ran out of memory with ${sizeLabel(sandboxSize(running))} after ${job}; it starts with ${sizeLabel(sandboxSize(next))} from now on`);
  }

  private async ensureContainer(): Promise<Container> {
    const container = this.ctx.container;
    if (!container) throw new Error("the SessionAgent container is not configured");
    if (container.running && !this.starting) return container;
    this.starting ??= this.startContainer(container).finally(() => (this.starting = null));
    return this.starting;
  }

  private async startContainer(container: Container): Promise<Container> {
    this.exit = null;
    this.intercepted.clear();
    await this.closeStale().catch((error: unknown) => console.error(`counting the last run of sandbox ${this.name} failed`, error));
    const step = await this.startStep();
    const run = Date.now();
    container.start({ image: container.images["coder"] as string, enableInternet: true, instance: sandboxSize(step) });
    container.monitor().then(
      () => this.stopped("its main process exited", run),
      (error: unknown) => this.stopped(String(error), run),
    );
    for (let waited = 0; !container.running && !this.exit && waited < 60_000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
    if (!container.running) throw new Error(`the sandbox container did not start: ${this.exit ?? "timed out"}`);
    await this.ctx.storage.put(RUNNING_SIZE, step);
    await this.ctx.storage.put(RUN, { run, since: Date.now(), step, cpu: await this.cpuNow() } satisfies Alive);
    await this.ctx.storage.delete(RESTART);
    const kills = oomKills((await this.shell(VMSTAT, {}).catch(() => ({ code: 1, out: "" }))).out);
    if (kills === null) await this.ctx.storage.delete(OOM_BASE);
    else await this.ctx.storage.put(OOM_BASE, kills);
    await container.setInactivityTimeout((await this.backstopSeconds()) * 1000).catch(() => undefined);
    return container;
  }

  private grant(outbound: Outbound): () => void {
    const id = ++this.granted;
    this.grants.set(id, outbound);
    this.lastGrant = outbound;
    if (outbound.llmHost) this.llmHost = outbound.llmHost;
    return () => void this.grants.delete(id);
  }

  private intercept(props: Outbound): Promise<void> {
    const next = this.intercepting.catch(() => undefined).then(() => this.interceptHosts(props));
    this.intercepting = next;
    return next;
  }

  private async interceptHosts(props: Outbound): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("the SessionAgent container is not configured");
    const hosts = [...new Set([props.artifactsHost, ...(props.llmHost ? [props.llmHost] : [])])].filter((host) => !this.intercepted.has(host));
    const addresses = [LAYER_CACHE_ADDRESS, ...(this.env.TRANSCRIPTS ? [TRANSCRIPT_ADDRESS, UPLOADS_ADDRESS] : [])].filter((address) => !this.intercepted.has(address));
    if (hosts.length === 0 && addresses.length === 0) return;
    const outbound = (this.ctx.exports as unknown as Record<string, (opts: { props: OutboundProps }) => Fetcher>)["SandboxOutbound"];
    if (!outbound) throw new Error("SandboxOutbound export is missing");
    const fetcher = outbound({ props: { sandbox: this.name } });
    for (const host of hosts) {
      await container.interceptOutboundHttps(host, fetcher);
      this.intercepted.add(host);
    }
    for (const address of addresses) {
      await container.interceptOutboundHttp(address, fetcher);
      this.intercepted.add(address);
    }
    const trusted = await container.exec(["sh", "/opt/chef/trust.sh"], { env: { PATH: ROOT_PATH }, user: "0:0", stdout: "pipe", stderr: "combined" });
    const out = await new Response(trusted.stdout as ReadableStream<Uint8Array>).text();
    if ((await trusted.exitCode) !== 0) console.error(`trusting Cloudflare's certificate in ${this.name} failed: ${out.slice(-300)}`);
  }
}

function turnResult(turn: TurnState): CoderTurnResult {
  const final = turn.result as TurnOutput;
  return { changes: final.changes, summary: final.summary, model: final.model, runId: turn.id, usage: final.usage ?? { inputTokens: 0, outputTokens: 0 } };
}

const LAUNCH = `for file in "$LANE"/*/pid; do [ -f "$file" ] || continue; pid=$(cat "$file" 2>/dev/null); [ -n "$pid" ] && { kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null; }; done
rm -rf "$LANE" 2>/dev/null; mkdir -p "$DIR" && cd "$DIR" || { echo "could not make $DIR"; exit 1; }
setsid sh -c 'echo $$ > pid.tmp && mv pid.tmp pid; node "/opt/chef/$SCRIPT" > events.jsonl 2> stderr.log; echo $? > exit.tmp && mv exit.tmp exit' < /dev/null > /dev/null 2>&1 &
for i in $(seq 1 100); do [ -s pid ] && exit 0; sleep 0.1; done
echo "the runner wrote no pid"; exit 1`;

const ALIVE = `alive() { state=$(cut -d " " -f 3 "/proc/$1/stat" 2>/dev/null); [ -n "$state" ] && [ "$state" != Z ]; }
pid=$(cat pid 2>/dev/null)`;

const STATE = `cd "$DIR" 2>/dev/null || { echo lost; exit 0; }
${ALIVE}
if [ -f exit ]; then cat exit; elif alive "$pid"; then echo running; else echo lost; fi`;

const FOLLOW = `cd "$DIR" 2>/dev/null || exit 0
${ALIVE}
if [ -f exit ] || ! alive "$pid"; then tail -n "+$FROM" events.jsonl; exit 0; fi
tail -n "+$FROM" -f events.jsonl &
follower=$!
ticks=$((WAIT * 4))
while [ "$ticks" -gt 0 ] && [ ! -f exit ] && alive "$pid"; do sleep 0.25; ticks=$((ticks - 1)); done
kill "$follower" 2>/dev/null
exit 0`;

const STOP_APP = `pkill -TERM -f "/opt/chef/[a]pp.mjs" || true`;

const APP_LOGS = `if [ -f "$FILE" ]; then docker compose -p "$PROJECT" -f "$FILE" logs --no-color --tail 40 2>&1 | tail -c 3000; else tail -n 40 "$LOG" 2>/dev/null | tail -c 3000; fi`;

const STDERR = `tail -c 4000 "$DIR/stderr.log" 2>/dev/null`;

const KILL = `pid=$(cat "$DIR/pid" 2>/dev/null) && { kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null; }; exit 0`;

const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const SANDBOX_ENV = { HOME: "/home/node", NODE_EXTRA_CA_CERTS: CA, PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers" };
const SANDBOX_USER = "1000:1000";
const ROOT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const VMSTAT = "cat /proc/vmstat";

async function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

function turnKey(lane: string | undefined): string {
  return lane ? `${TURN}/${lane}` : TURN;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function splitLines(flush: boolean): TransformStream<string, string> {
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) controller.enqueue(part);
    },
    flush(controller) {
      if (flush && buffer.trim()) controller.enqueue(buffer);
    },
  });
}
