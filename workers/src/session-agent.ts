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
}

interface OutboundProps {
  readonly artifactsHost: string;
  readonly readToken: string;
  readonly allowHosts: readonly string[];
  readonly llmHost: string | null;
  readonly llmKey: string | null;
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
    } else if (this.ctx.props.cloudflare && cloudflareAllowed(url, this.ctx.props.cloudflare)) {
      const current = headers.get("authorization");
      if (current?.includes(PLACEHOLDER)) headers.set("authorization", current.replace(PLACEHOLDER, this.env.CF_API_TOKEN));
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
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface SandboxStatus {
  readonly running: boolean;
  readonly exit: string | null;
}

export class SessionAgent extends Agent<Env> {
  private exit: string | null = null;

  async status(): Promise<SandboxStatus> {
    return { running: this.ctx.container?.running ?? false, exit: this.exit };
  }

  async runTurn(job: SandboxJob, onEvent: (event: CoderEvent) => void, llmKey: string): Promise<CoderTurnResult> {
    let result: TurnOutput | null = null;
    const { code, tail } = await this.runScript(
      "runner.mjs",
      job,
      (event) => {
        if (event["type"] === "chef.result") result = event as unknown as typeof result;
        else onEvent(event as unknown as CoderEvent);
      },
      llmKey,
    );
    const final = result as TurnOutput | null;
    if (code !== 0 || !final) {
      onEvent({ type: "session.error", message: tail || `runner exited with ${code}` });
      throw new Error(`coder runner failed with exit code ${code}: ${tail.slice(-500)}`);
    }
    return { changes: final.changes, summary: final.summary, model: final.model, runId: `${job.sessionId}-${Date.now()}`, usage: final.usage ?? { inputTokens: 0, outputTokens: 0 } };
  }

  async runChecks(job: ChecksJob): Promise<CommandResult[]> {
    let results: CommandResult[] | null = null;
    const { code, tail } = await this.runScript("checks.mjs", job, (event) => {
      if (event["type"] === "chef.checks") results = event["results"] as CommandResult[];
    });
    if (!results) throw new Error(`checks runner failed with exit code ${code}: ${tail.slice(-500)}`);
    return results;
  }

  private async runScript(script: string, job: { remote: string; readToken: string; allowHosts?: readonly string[]; llm?: { readonly baseUrl: string }; cloudflare?: CloudflareGrant }, onEvent: (event: Record<string, unknown>) => void, llmKey: string | null = null): Promise<{ code: number; tail: string }> {
    const container = this.ctx.container;
    if (!container) throw new Error("the SessionAgent container is not configured");
    if (!container.running) {
      this.exit = null;
      container.start({ image: container.images["coder"] as string, enableInternet: false, instance: SANDBOX_INSTANCE });
      container.monitor().then(
        () => (this.exit = "its main process exited"),
        (error: unknown) => (this.exit = String(error)),
      );
      for (let waited = 0; !container.running && !this.exit && waited < 60_000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
      if (!container.running) throw new Error(`the sandbox container did not start: ${this.exit ?? "timed out"}`);
    }
    const outbound = (this.ctx.exports as unknown as Record<string, (opts: { props: OutboundProps }) => Fetcher>)["SandboxOutbound"];
    if (!outbound) throw new Error("SandboxOutbound export is missing");
    await container.interceptOutboundHttps("*", outbound({ props: { artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, allowHosts: [...(job.allowHosts ?? [])], llmHost: job.llm ? new URL(job.llm.baseUrl).hostname : null, llmKey, cloudflare: job.cloudflare ?? null } }));
    const { readToken, ...visible } = job;
    void readToken;
    const process = await container.exec(["node", `/opt/chef/${script}`], { env: { ...SANDBOX_ENV, CHEF_JOB: toBase64(JSON.stringify(visible)) }, user: SANDBOX_USER, stdout: "pipe", stderr: "combined" }).catch((error: unknown) => {
      throw new Error(`${String(error)} (the sandbox container stopped: ${this.exit ?? "no reason reported"})`);
    });
    const lines = (process.stdout as ReadableStream<Uint8Array>).pipeThrough(new TextDecoderStream()).pipeThrough(splitLines());
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
}

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

function splitLines(): TransformStream<string, string> {
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) if (part.trim()) controller.enqueue(part);
    },
    flush(controller) {
      if (buffer.trim()) controller.enqueue(buffer);
    },
  });
}
