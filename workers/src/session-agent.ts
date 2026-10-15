import { Agent } from "agents";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { AppStatus, CoderEvent, CoderTurnResult, CustomAgent, FileChanges } from "@chef/core";
import { APP_REQUEST_HEADER } from "@chef/adapters/app-gate";
import { appPage } from "@chef/adapters/app-page";
import { layerStore } from "./image-layers.ts";
import { REGISTRY_HOSTS, registryFetch } from "./registry-cache.ts";

export const PLACEHOLDER = "chef-placeholder";

export interface SandboxJob {
  readonly sessionId: string;
  readonly featureId: string;
  readonly role: string;
  readonly model: string;
  readonly prompt: string;
  readonly agent: CustomAgent;
  readonly writeScope: readonly string[];
  readonly remote: string;
  readonly ref: string;
  readonly commitId: string;
  readonly readToken: string;
  readonly llm: { readonly baseUrl: string };
  readonly turnId?: string;
}

export type TurnOutcome = { readonly status: "done"; readonly result: CoderTurnResult } | { readonly status: "running" } | { readonly status: "lost" };

interface OutboundProps {
  readonly artifactsHost: string;
  readonly readToken: string;
  readonly llmHost: string | null;
  readonly llmKey: string | null;
}

export class SandboxOutbound extends WorkerEntrypoint<Env, OutboundProps> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== "https:") return new Response("https only", { status: 403 });
    if (REGISTRY_HOSTS.has(url.hostname)) return registryFetch(request, { store: layerStore(this.env.IMAGE_LAYERS), upstream: (forward) => fetch(forward, { redirect: "manual" }), waitUntil: (work) => this.ctx.waitUntil(work), now: Date.now });
    const headers = new Headers(request.headers);
    if (url.hostname === this.ctx.props.artifactsHost) {
      if (url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack") return new Response("the coder sandbox cannot push", { status: 403 });
      headers.set("authorization", `Bearer ${this.ctx.props.readToken}`);
    } else if (url.hostname === this.ctx.props.llmHost && this.ctx.props.llmKey) {
      const llmKey = this.ctx.props.llmKey;
      for (const name of ["x-api-key", "authorization"]) {
        const current = headers.get(name);
        if (current?.includes(PLACEHOLDER)) headers.set(name, current.replace(PLACEHOLDER, llmKey));
      }
    }
    return fetch(new Request(request, { headers }));
  }
}

export interface ChecksJob {
  readonly sessionId: string;
  readonly remote: string;
  readonly ref: string;
  readonly commitId: string;
  readonly readToken: string;
  readonly commands: readonly { name: string; argv: readonly string[]; timeoutMs?: number; env?: Readonly<Record<string, string>> }[];
  readonly overlay?: FileChanges;
}

export interface AppJob {
  readonly target: string;
  readonly project: string;
  readonly remote: string;
  readonly ref: string;
  readonly commitId: string;
  readonly env: Readonly<Record<string, string>>;
  readonly idleMinutes: number;
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
}

export interface CommandResult {
  readonly name: string;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface TurnOutput {
  readonly changes: FileChanges;
  readonly summary: string;
  readonly model: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedInputTokens?: number };
}

export interface SandboxStatus {
  readonly running: boolean;
  readonly exit: string | null;
}

export const SANDBOX_IDLE_SECONDS = 300;
export const FOLLOW_SECONDS = 60;

const LAST_USED = "sandbox/last-used";
const APP = "sandbox/app";
const VISIT_NOTE_MS = 30_000;
const TURN = "sandbox/turn";
const TURNS_DIR = "/workspace/turns";

type Outbound = Omit<OutboundProps, "llmKey">;

interface TurnState {
  readonly id: string;
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
  private following: string | null = null;
  private visited = 0;
  private appRun: Promise<AppState> | null = null;

  async status(): Promise<SandboxStatus> {
    return { running: this.ctx.container?.running ?? false, exit: this.exit };
  }

  async stop(): Promise<boolean> {
    const container = this.ctx.container;
    if (!container?.running || this.busy > 0) return false;
    await container.destroy();
    return true;
  }

  async discard(): Promise<void> {
    const container = this.ctx.container;
    if (container?.running) await container.destroy().catch(() => undefined);
    await this.destroy();
  }

  async sleepIfIdle(): Promise<void> {
    const container = this.ctx.container;
    if (!container?.running) return;
    const lastUsed = (await this.ctx.storage.get<number>(LAST_USED)) ?? 0;
    const idleFor = Date.now() - lastUsed;
    const idleSeconds = await this.idleSeconds();
    if (this.busy === 0 && idleFor >= idleSeconds * 1000 && !(await this.turnAlive())) {
      await container.destroy();
      return;
    }
    await this.schedule(Math.max(30, Math.ceil(idleSeconds - idleFor / 1000)), "sleepIfIdle", undefined, { idempotent: true });
  }

  async runTurn(job: SandboxJob, onEvent: (event: CoderEvent) => void, llmKey: string): Promise<TurnOutcome> {
    const id = job.turnId ?? `${job.sessionId}-${Date.now()}`;
    let turn = await this.ctx.storage.get<TurnState>(TURN);
    if (turn?.id !== id) turn = await this.launch(id, job, llmKey);
    return this.follow(turn, onEvent, llmKey, job.turnId ? FOLLOW_SECONDS : null);
  }

  async resumeTurn(id: string, onEvent: (event: CoderEvent) => void, llmKey: string): Promise<TurnOutcome> {
    const turn = await this.ctx.storage.get<TurnState>(TURN);
    if (turn?.id !== id) return { status: "lost" };
    return this.follow(turn, onEvent, llmKey, FOLLOW_SECONDS);
  }

  private async launch(id: string, job: SandboxJob, llmKey: string): Promise<TurnState> {
    await this.stopTurn();
    await this.ensureContainer();
    const outbound: Outbound = { artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, llmHost: new URL(job.llm.baseUrl).hostname };
    await this.intercept(outbound, { llmKey });
    this.following = id;
    const turn: TurnState = { id, dir: `${TURNS_DIR}/${id}`, model: job.model, outbound, delivered: 0, result: null, done: false };
    const { readToken, turnId, ...visible } = job;
    void readToken;
    void turnId;
    const started = await this.shell(LAUNCH, { DIR: turn.dir, TURNS: TURNS_DIR, SCRIPT: "runner.mjs", CHEF_JOB: toBase64(JSON.stringify(visible)) });
    if (started.code !== 0) throw new Error(`the coder runner did not start: ${started.out.slice(-500)}`);
    await this.ctx.storage.put(TURN, turn);
    return turn;
  }

  private async follow(turn: TurnState, onEvent: (event: CoderEvent) => void, llmKey: string, seconds: number | null): Promise<TurnOutcome> {
    if (turn.done && turn.result) return { status: "done", result: turnResult(turn) };
    if (!this.ctx.container?.running) return { status: "lost" };
    if (this.following !== turn.id) await this.intercept(turn.outbound, { llmKey });
    this.following = turn.id;
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
      await this.ctx.storage.put(TURN, turn);
      await this.ctx.storage.put(LAST_USED, Date.now());
      await this.scheduleSleep();
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
        await this.ctx.storage.put(TURN, turn);
      }
    }
    await process.exitCode;
  }

  private async turnAlive(): Promise<boolean> {
    const turn = await this.ctx.storage.get<TurnState>(TURN);
    if (!turn || turn.done) return false;
    return (await this.shell(STATE, { DIR: turn.dir }).catch(() => ({ code: 1, out: "lost" }))).out.trim() === "running";
  }

  private async stopTurn(): Promise<void> {
    const turn = await this.ctx.storage.get<TurnState>(TURN);
    await this.ctx.storage.delete(TURN);
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
    let results: CommandResult[] | null = null;
    const { code, tail } = await this.runScript("checks.mjs", job, (event) => {
      if (event["type"] === "chef.checks") results = event["results"] as CommandResult[];
    });
    if (!results) throw new Error(`checks runner failed with exit code ${code}: ${tail.slice(-500)}`);
    return results;
  }

  async runApp(job: AppJob, readToken: string): Promise<AppState> {
    if (this.appRun) return this.appRun;
    this.appRun = this.startApp(job, readToken).finally(() => (this.appRun = null));
    return this.appRun;
  }

  private async startApp(job: AppJob, readToken: string): Promise<AppState> {
    let state: AppState = { status: "starting", target: job.target, project: job.project, commitId: job.commitId, port: null, idleMinutes: job.idleMinutes, at: Date.now() };
    await this.ctx.storage.put(APP, state);
    const { code, tail } = await this.runScript("app.mjs", { ...job, readToken }, (event) => {
      if (event["type"] !== "chef.app") return;
      const status = event["status"] as AppStatus;
      const port = typeof event["port"] === "number" ? event["port"] : null;
      state = { ...state, status, port, at: Date.now(), ...(typeof event["error"] === "string" ? { error: event["error"] } : {}) };
      void this.ctx.storage.put(APP, state);
    });
    if (state.status === "starting") state = { ...state, status: "failed", error: `the app runner stopped with exit code ${code}: ${tail.slice(-500) || "no output"}`, at: Date.now() };
    await this.ctx.storage.put(APP, state);
    if (state.status === "running") await this.ctx.container?.setInactivityTimeout((await this.idleSeconds()) * 1000).catch(() => undefined);
    return state;
  }

  async appState(): Promise<AppState | null> {
    const state = (await this.ctx.storage.get<AppState>(APP)) ?? null;
    if (!state || this.ctx.container?.running) return state;
    return state.status === "running" || state.status === "starting" ? { ...state, status: "asleep" } : state;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get(APP_REQUEST_HEADER) !== "1") return super.fetch(request);
    const state = await this.appState();
    const container = this.ctx.container;
    if (!container?.running || state?.status !== "running" || !state.port) {
      if (state && (state.status === "asleep" || state.status === "running")) this.ctx.waitUntil(this.wake(state));
      if (state?.status === "failed") return appPage({ status: "failed", target: state.target, ...(state.error ? { error: state.error } : {}) });
      if (state?.status === "no-stack") return appPage({ status: "no-stack", target: state.target });
      return appPage({ status: state ? "starting" : "missing", target: state?.target ?? this.name });
    }
    if (Date.now() - this.visited > VISIT_NOTE_MS) {
      this.visited = Date.now();
      await this.ctx.storage.put(LAST_USED, this.visited);
      await this.scheduleSleep();
    }
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete(APP_REQUEST_HEADER);
    return container.getTcpPort(state.port).fetch(new Request(`http://localhost:${state.port}${url.pathname}${url.search}`, new Request(request, { headers })));
  }

  private async wake(state: AppState): Promise<void> {
    await (this.env.PROJECT.get(this.env.PROJECT.idFromName(state.project)) as unknown as { wakeApp(target: string): Promise<void> }).wakeApp(state.target).catch((error: unknown) => console.error(`waking the app of ${state.target} failed`, error));
  }

  private async idleSeconds(): Promise<number> {
    const app = await this.ctx.storage.get<AppState>(APP);
    return Math.max(SANDBOX_IDLE_SECONDS, app && app.status === "running" ? app.idleMinutes * 60 : 0);
  }

  private async scheduleSleep(): Promise<void> {
    await this.schedule(await this.idleSeconds(), "sleepIfIdle", undefined, { idempotent: true });
  }

  private async runScript(script: string, job: { remote: string; readToken: string; llm?: { readonly baseUrl: string } }, onEvent: (event: Record<string, unknown>) => void, secrets: { readonly llmKey?: string | null } = {}): Promise<{ code: number; tail: string }> {
    this.busy++;
    try {
      return await this.exec(script, job, onEvent, secrets);
    } finally {
      this.busy--;
      await this.ctx.storage.put(LAST_USED, Date.now());
      await this.scheduleSleep();
    }
  }

  private async exec(script: string, job: { remote: string; readToken: string; llm?: { readonly baseUrl: string } }, onEvent: (event: Record<string, unknown>) => void, secrets: { readonly llmKey?: string | null }): Promise<{ code: number; tail: string }> {
    const container = await this.ensureContainer();
    this.following = null;
    await this.intercept({ artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, llmHost: job.llm ? new URL(job.llm.baseUrl).hostname : null }, secrets);
    const { readToken, ...visible } = job;
    void readToken;
    const process = await container.exec(["node", `/opt/chef/${script}`], { env: { ...SANDBOX_ENV, CHEF_JOB: toBase64(JSON.stringify(visible)) }, user: SANDBOX_USER, stdout: "pipe", stderr: "combined" }).catch((error: unknown) => {
      throw new Error(`${String(error)} (the sandbox container stopped: ${this.exit ?? "no reason reported"})`);
    });
    const lines = (process.stdout as ReadableStream<Uint8Array>).pipeThrough(new TextDecoderStream()).pipeThrough(splitLines(true));
    let tail = "";
    for await (const line of lines) {
      try {
        onEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        tail = `${tail}${line}\n`.slice(-4000);
      }
    }
    return { code: await process.exitCode, tail };
  }

  private async ensureContainer(): Promise<Container> {
    const container = this.ctx.container;
    if (!container) throw new Error("the SessionAgent container is not configured");
    if (container.running) return container;
    this.exit = null;
    container.start({ image: container.images["coder"] as string, enableInternet: true, instance: SANDBOX_INSTANCE });
    container.monitor().then(
      () => (this.exit = "its main process exited"),
      (error: unknown) => (this.exit = String(error)),
    );
    for (let waited = 0; !container.running && !this.exit && waited < 60_000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
    if (!container.running) throw new Error(`the sandbox container did not start: ${this.exit ?? "timed out"}`);
    await container.setInactivityTimeout((await this.idleSeconds()) * 1000).catch(() => undefined);
    return container;
  }

  private async intercept(props: Outbound, secrets: { readonly llmKey?: string | null }): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("the SessionAgent container is not configured");
    const outbound = (this.ctx.exports as unknown as Record<string, (opts: { props: OutboundProps }) => Fetcher>)["SandboxOutbound"];
    if (!outbound) throw new Error("SandboxOutbound export is missing");
    const fetcher = outbound({ props: { ...props, llmKey: secrets.llmKey ?? null } });
    for (const host of new Set([props.artifactsHost, ...(props.llmHost ? [props.llmHost] : []), ...REGISTRY_HOSTS])) await container.interceptOutboundHttps(host, fetcher);
    const trusted = await container.exec(["sh", "/opt/chef/trust.sh"], { env: { PATH: ROOT_PATH }, user: "0:0", stdout: "pipe", stderr: "combined" });
    const out = await new Response(trusted.stdout as ReadableStream<Uint8Array>).text();
    if ((await trusted.exitCode) !== 0) console.error(`trusting Cloudflare's certificate in ${this.name} failed: ${out.slice(-300)}`);
  }
}

function turnResult(turn: TurnState): CoderTurnResult {
  const final = turn.result as TurnOutput;
  return { changes: final.changes, summary: final.summary, model: final.model, runId: turn.id, usage: final.usage ?? { inputTokens: 0, outputTokens: 0 } };
}

const LAUNCH = `for proc in /proc/[0-9]*; do [ "\${proc#/proc/}" = "$$" ] && continue; case "$(tr '\\0' ' ' < "$proc/cmdline" 2>/dev/null)" in *"/opt/chef/runner.mjs"*|*"claude-agent-sdk"*) kill -TERM "\${proc#/proc/}" 2>/dev/null ;; esac; done
rm -rf "$TURNS" && mkdir -p "$DIR" && cd "$DIR" || exit 1
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

const STDERR = `tail -c 4000 "$DIR/stderr.log" 2>/dev/null`;

const KILL = `pid=$(cat "$DIR/pid" 2>/dev/null) && { kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null; }; exit 0`;

const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const SANDBOX_ENV = { HOME: "/home/node", NODE_EXTRA_CA_CERTS: CA, PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers" };
const SANDBOX_USER = "1000:1000";
const ROOT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const SANDBOX_INSTANCE = "standard-2";

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
