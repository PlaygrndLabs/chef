import { Agent } from "agents";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { CoderEvent, CoderTurnResult, CustomAgent, FileChanges } from "@kargah/core";

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
}

interface OutboundProps {
  readonly artifactsHost: string;
  readonly readToken: string;
  readonly allowHosts: readonly string[];
}

const COPILOT_HOSTS = [/(^|\.)github\.com$/, /(^|\.)githubcopilot\.com$/, /(^|\.)githubusercontent\.com$/];

export class SandboxOutbound extends WorkerEntrypoint<Env, OutboundProps> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== "https:") return new Response("https only", { status: 403 });
    const headers = new Headers(request.headers);
    if (url.hostname === this.ctx.props.artifactsHost) {
      if (url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack") return new Response("the coder sandbox cannot push", { status: 403 });
      headers.set("authorization", `Bearer ${this.ctx.props.readToken}`);
    } else if (COPILOT_HOSTS.some((host) => host.test(url.hostname))) {
      const current = headers.get("authorization") ?? "";
      if (current.includes("kargah-placeholder")) headers.set("authorization", current.replace("kargah-placeholder", this.env.COPILOT_GITHUB_TOKEN));
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
  readonly commands: readonly { name: string; argv: readonly string[]; timeoutMs?: number }[];
  readonly allowHosts?: readonly string[];
  readonly overlay?: FileChanges;
}

export interface CommandResult {
  readonly name: string;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class SessionAgent extends Agent<Env> {
  async runTurn(job: SandboxJob, onEvent: (event: CoderEvent) => void): Promise<CoderTurnResult> {
    let result: { changes: FileChanges; summary: string; model: string } | null = null;
    const { code, tail } = await this.runScript("runner.mjs", job, (event) => {
      if (event["type"] === "kargah.result") result = event as unknown as typeof result;
      else onEvent(event as unknown as CoderEvent);
    });
    const final = result as { changes: FileChanges; summary: string; model: string } | null;
    if (code !== 0 || !final) {
      onEvent({ type: "session.error", message: tail || `runner exited with ${code}` });
      throw new Error(`coder runner failed with exit code ${code}: ${tail.slice(-500)}`);
    }
    return { changes: final.changes, summary: final.summary, model: final.model, runId: `${job.sessionId}-${Date.now()}`, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async runChecks(job: ChecksJob): Promise<CommandResult[]> {
    let results: CommandResult[] | null = null;
    const { code, tail } = await this.runScript("checks.mjs", job, (event) => {
      if (event["type"] === "kargah.checks") results = event["results"] as CommandResult[];
    });
    if (!results) throw new Error(`checks runner failed with exit code ${code}: ${tail.slice(-500)}`);
    return results;
  }

  private async runScript(script: string, job: { remote: string; readToken: string; allowHosts?: readonly string[] }, onEvent: (event: Record<string, unknown>) => void): Promise<{ code: number; tail: string }> {
    const container = this.ctx.container;
    if (!container) throw new Error("the SessionAgent container is not configured");
    if (!container.running) container.start({ image: container.images["coder"] as string, enableInternet: false });
    const outbound = (this.ctx.exports as unknown as Record<string, (opts: { props: OutboundProps }) => Fetcher>)["SandboxOutbound"];
    if (!outbound) throw new Error("SandboxOutbound export is missing");
    await container.interceptOutboundHttps("*", outbound({ props: { artifactsHost: new URL(job.remote).hostname, readToken: job.readToken, allowHosts: [...(job.allowHosts ?? [])] } }));
    const { readToken, ...visible } = job;
    void readToken;
    const process = await container.exec(["node", `/opt/kargah/${script}`], { env: { KARGAH_JOB: toBase64(JSON.stringify(visible)) }, stdout: "pipe", stderr: "combined" });
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
