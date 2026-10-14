import { Agent } from "agents";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { CoderEvent, CoderTurnResult, CustomAgent, FileChanges } from "@chef/core";
import { cloudflareAllowed, PLACEHOLDER, type CloudflareGrant } from "./sandbox-grants.ts";

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
  readonly allowHosts: readonly string[];
  readonly llmHost: string | null;
  readonly llmKey: string | null;
  readonly cloudflareToken: string | null;
  readonly cloudflare: CloudflareGrant | null;
}

export class SandboxOutbound extends WorkerEntrypoint<Env, OutboundProps> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== "https:") return new Response("https only", { status: 403 });
    const headers = new Headers(request.headers);
    if (url.hostname === this.ctx.props.artifactsHost) {
      if (url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack") return new Response("the coder sandbox cannot push", { status: 403 });
      headers.set("authorization", `Bearer ${this.ctx.props.readToken}`);
    } else if (this.ctx.props.cloudflare && this.ctx.props.cloudflareToken && cloudflareAllowed(url, this.ctx.props.cloudflare)) {
      const current = headers.get("authorization");
      if (current?.includes(PLACEHOLDER)) headers.set("authorization", current.replace(PLACEHOLDER, this.ctx.props.cloudflareToken));
    } else if (url.hostname === this.ctx.props.llmHost && this.ctx.props.llmKey) {
      const llmKey = this.ctx.props.llmKey;
      for (const name of ["x-api-key", "authorization"]) {
        const current = headers.get(name);
        if (current?.includes(PLACEHOLDER)) headers.set(name, current.replace(PLACEHOLDER, llmKey));
      }
    } else if (!this.ctx.props.allowHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      return new Response(`host ${url.hostname} is not allowed from the coder sandbox`, { status: 403 });
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
  readonly allowHosts?: readonly string[];
  readonly cloudflare?: CloudflareGrant;
  readonly overlay?: FileChanges;
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
const TURN = "sandbox/turn";
const TURNS_DIR = "/workspace/turns";

type Outbound = Omit<OutboundProps, "llmKey" | "cloudflareToken">;

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

  async status(): Promise<SandboxStatus> {
    return { running: this.ctx.container?.running ?? false, exit: this.exit };
  }

  async stop(): Promise<boolean> {
    const container = this.ctx.container;
    if (!container?.running || this.busy > 0) return false;
    await container.destroy();
    return true;
  }

  async sleepIfIdle(): Promise<void> {
    const container = this.ctx.container;
    if (!container?.running) return;
    const lastUsed = (await this.ctx.storage.get<number>(LAST_USED)) ?? 0;
    const idleFor = Date.now() - lastUsed;
    if (this.busy === 0 && idleFor >= SANDBOX_IDLE_SECONDS * 1000 && !(await this.turnAlive())) {
      await container.destroy();
      return;
    }
    await this.schedule(Math.max(30, Math.ceil(SANDBOX_IDLE_SECONDS - idleFor / 1000)), "sleepIfIdle", undefined, { idempotent: true });
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
    const outbound: Outbound = { artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, allowHosts: [], llmHost: new URL(job.llm.baseUrl).hostname, cloudflare: null };
    await this.intercept(outbound, { llmKey });
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
    await this.intercept(turn.outbound, { llmKey });
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
      await this.schedule(SANDBOX_IDLE_SECONDS, "sleepIfIdle", undefined, { idempotent: true });
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

  async runChecks(job: ChecksJob, cloudflareToken: string | null = null): Promise<CommandResult[]> {
    let results: CommandResult[] | null = null;
    const { code, tail } = await this.runScript(
      "checks.mjs",
      job,
      (event) => {
        if (event["type"] === "chef.checks") results = event["results"] as CommandResult[];
      },
      { cloudflareToken },
    );
    if (!results) throw new Error(`checks runner failed with exit code ${code}: ${tail.slice(-500)}`);
    return results;
  }

  private async runScript(script: string, job: { remote: string; readToken: string; allowHosts?: readonly string[]; llm?: { readonly baseUrl: string }; cloudflare?: CloudflareGrant }, onEvent: (event: Record<string, unknown>) => void, secrets: { readonly llmKey?: string | null; readonly cloudflareToken?: string | null } = {}): Promise<{ code: number; tail: string }> {
    this.busy++;
    try {
      return await this.exec(script, job, onEvent, secrets);
    } finally {
      this.busy--;
      await this.ctx.storage.put(LAST_USED, Date.now());
      await this.schedule(SANDBOX_IDLE_SECONDS, "sleepIfIdle", undefined, { idempotent: true });
    }
  }

  private async exec(script: string, job: { remote: string; readToken: string; allowHosts?: readonly string[]; llm?: { readonly baseUrl: string }; cloudflare?: CloudflareGrant }, onEvent: (event: Record<string, unknown>) => void, secrets: { readonly llmKey?: string | null; readonly cloudflareToken?: string | null }): Promise<{ code: number; tail: string }> {
    const container = await this.ensureContainer();
    await this.intercept({ artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, allowHosts: [...(job.allowHosts ?? [])], llmHost: job.llm ? new URL(job.llm.baseUrl).hostname : null, cloudflare: job.cloudflare ?? null }, secrets);
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
    container.start({ image: container.images["coder"] as string, enableInternet: false, instance: SANDBOX_INSTANCE });
    container.monitor().then(
      () => (this.exit = "its main process exited"),
      (error: unknown) => (this.exit = String(error)),
    );
    for (let waited = 0; !container.running && !this.exit && waited < 60_000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
    if (!container.running) throw new Error(`the sandbox container did not start: ${this.exit ?? "timed out"}`);
    await container.setInactivityTimeout(SANDBOX_IDLE_SECONDS * 1000).catch(() => undefined);
    return container;
  }

  private async intercept(props: Outbound, secrets: { readonly llmKey?: string | null; readonly cloudflareToken?: string | null }): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("the SessionAgent container is not configured");
    const outbound = (this.ctx.exports as unknown as Record<string, (opts: { props: OutboundProps }) => Fetcher>)["SandboxOutbound"];
    if (!outbound) throw new Error("SandboxOutbound export is missing");
    await container.interceptOutboundHttps("*", outbound({ props: { ...props, llmKey: secrets.llmKey ?? null, cloudflareToken: secrets.cloudflareToken ?? null } }));
  }
}

function turnResult(turn: TurnState): CoderTurnResult {
  const final = turn.result as TurnOutput;
  return { changes: final.changes, summary: final.summary, model: final.model, runId: turn.id, usage: final.usage ?? { inputTokens: 0, outputTokens: 0 } };
}

const LAUNCH = `rm -rf "$TURNS" && mkdir -p "$DIR" && cd "$DIR" || exit 1
setsid sh -c 'echo $$ > pid.tmp && mv pid.tmp pid; node "/opt/chef/$SCRIPT" > events.jsonl 2> stderr.log; echo $? > exit.tmp && mv exit.tmp exit' < /dev/null > /dev/null 2>&1 &
for i in $(seq 1 100); do [ -s pid ] && exit 0; sleep 0.1; done
echo "the runner wrote no pid"; exit 1`;

const STATE = `cd "$DIR" 2>/dev/null || { echo lost; exit 0; }
if [ -f exit ]; then cat exit; elif kill -0 "$(cat pid 2>/dev/null)" 2>/dev/null; then echo running; else echo lost; fi`;

const FOLLOW = `cd "$DIR" 2>/dev/null || exit 0
pid=$(cat pid 2>/dev/null)
if [ -f exit ] || ! kill -0 "$pid" 2>/dev/null; then tail -n "+$FROM" events.jsonl; exit 0; fi
timeout "$WAIT" tail -n "+$FROM" -f --pid="$pid" events.jsonl
exit 0`;

const STDERR = `tail -c 4000 "$DIR/stderr.log" 2>/dev/null`;

const KILL = `pid=$(cat "$DIR/pid" 2>/dev/null) && kill -TERM -- "-$pid" 2>/dev/null; exit 0`;

const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const SANDBOX_ENV = { HOME: "/home/node", NODE_EXTRA_CA_CERTS: CA, GIT_SSL_CAINFO: CA, SSL_CERT_FILE: CA, PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers" };
const SANDBOX_USER = "1000:1000";
const SANDBOX_INSTANCE = "standard-1";

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
