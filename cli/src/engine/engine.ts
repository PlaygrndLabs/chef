import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { ChefAgent, type ChefLink } from "@chef/adapters/agui";
import { agentsRequest } from "@chef/adapters/agents";
import { aesCipher, envKeyBytes, newEnvKey, type EnvCipher } from "@chef/adapters/project-env";
import { AgentSettings } from "@chef/core";
import { LocalGitHost } from "@chef/adapters/local-git";
import { buildingPage, previewPath } from "@chef/adapters/preview-page";
import { projectsRequest, type ProjectEntry } from "@chef/adapters/projects";
import { applyUpdate, describeSettings, NO_LLM, NO_SETTINGS, resolveSettings, type AppSettings, type Resolved, type SettingsEnv } from "@chef/adapters/settings";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { parseJsonc } from "../deploy.ts";
import { repoProfiles, REPO_ROOT } from "../world.ts";
import { Docker, type Network } from "./docker.ts";
import { LocalProject } from "./project.ts";
import { FileStore, writeAtomic, type LogEntry } from "./storage.ts";

const PROJECT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/(.+)$/;
const COPILOTKIT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/copilotkit(\/|$)/;
const PREVIEW = /^\/preview\/([a-z][a-z0-9-]{1,30})\/([a-z0-9-]{1,80})\/?$/;
const SOCKET = /^\/agents\/project\/([a-z][a-z0-9-]{1,30})$/;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const NO_GITHUB_APP = "Connect GitHub needs chef in Cloudflare. On this computer, pick Other git host and use the repository's address with an access token.";

export function localHome(): string {
  return join(process.env["CHEF_HOME"] ?? join(homedir(), ".chef"), "local");
}

export function engineVars(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const base = (parseJsonc(readFileSync(join(REPO_ROOT, "wrangler.jsonc"), "utf8"))["vars"] ?? {}) as Record<string, string>;
  const out: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(env)) if (value !== undefined && value !== "") out[key] = value;
  return out;
}

export interface EngineOptions {
  readonly dir?: string;
  readonly network?: Network;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (line: string) => void;
  readonly docker?: Docker;
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function frame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  let head: Buffer;
  if (payload.length < 126) head = Buffer.from([0x81, payload.length]);
  else if (payload.length < 65536) {
    head = Buffer.from([0x81, 126, 0, 0]);
    head.writeUInt16BE(payload.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([head, payload]);
}

export class LocalEngine {
  readonly dir: string;
  readonly docker: Docker;
  private readonly git: LocalGitHost;
  private readonly projects = new Map<string, Promise<LocalProject>>();
  private readonly copilots = new Map<string, (request: Request) => Promise<Response>>();
  private readonly sockets = new Set<Duplex>();
  private readonly vars: Record<string, string>;
  private readonly log: (line: string) => void;
  private readonly agents: AgentSettings;
  private cipher: Promise<EnvCipher> | null = null;
  private saved: AppSettings;

  private constructor(options: EngineOptions) {
    this.dir = options.dir ?? localHome();
    this.vars = engineVars(options.env);
    this.log = options.log ?? (() => {});
    this.git = new LocalGitHost(join(this.dir, "repos"));
    this.docker = options.docker ?? new Docker({ repos: this.git.root, network: options.network ?? (this.vars["CHEF_SANDBOX_NETWORK"] === "host" ? "host" : "bridge") });
    this.saved = { ...NO_SETTINGS, ...readJson<Partial<AppSettings>>(join(this.dir, "settings.json"), {}) };
    this.agents = new AgentSettings(new FileStore(join(this.dir, "agents.jsonl")));
  }

  private envCipher(): Promise<EnvCipher> {
    this.cipher ??= (async () => {
      const file = join(this.dir, "env.key");
      if (!existsSync(file)) writeAtomic(file, newEnvKey());
      return aesCipher(envKeyBytes(readFileSync(file, "utf8").trim()));
    })();
    this.cipher.catch(() => (this.cipher = null));
    return this.cipher;
  }

  static async start(options: EngineOptions = {}): Promise<LocalEngine> {
    const engine = new LocalEngine(options);
    const problem = engine.docker.available();
    if (problem) throw new Error(problem);
    await engine.git.start();
    await engine.docker.prepare(engine.log);
    for (const entry of engine.registry()) await engine.project(entry.name);
    return engine;
  }

  settings(): Resolved {
    return resolveSettings(this.saved, this.vars as SettingsEnv);
  }

  private registry(): ProjectEntry[] {
    return readJson<ProjectEntry[]>(join(this.dir, "projects.json"), []);
  }

  private project(name: string): Promise<LocalProject> {
    let project = this.projects.get(name);
    if (!project) {
      project = (async () => {
        const created = new LocalProject(name, { dir: this.dir, docker: this.docker, control: this.git.control({ read: true }), settings: () => this.settings(), agents: this.agents, cipher: () => this.envCipher(), vars: this.vars, log: this.log });
        await created.open();
        return created;
      })();
      this.projects.set(name, project);
      project.catch(() => this.projects.delete(name));
    }
    return project;
  }

  private known(name: string): boolean {
    return this.registry().some((p) => p.name === name);
  }

  private settingsView() {
    return { ...describeSettings(this.saved, this.vars as SettingsEnv), password: "none", runsOn: "computer", dataDir: this.dir };
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/settings") return this.settingsRequest(request);
    if (url.pathname === "/api/agents" || url.pathname === "/api/agents/restore") {
      const settings = this.settings();
      return agentsRequest(request, { store: this.agents, defaults: repoProfiles(), models: settings.models, jev: settings.jev !== null });
    }
    if (url.pathname === "/api/projects") {
      return projectsRequest(
        request,
        {
          projects: async () => this.registry(),
          addProject: async (entry) => {
            const list = this.registry();
            if (list.some((p) => p.name === entry.name)) return false;
            writeAtomic(join(this.dir, "projects.json"), JSON.stringify([...list, entry], null, 1));
            return true;
          },
        },
        async (name, path, init) => (await this.project(name)).request(new Request(`${url.origin}/api/projects/${name}/${path}`, init), path),
      );
    }
    if (url.pathname === "/api/github" || url.pathname.startsWith("/api/github/")) {
      if (request.method === "GET" && url.pathname === "/api/github") return Response.json({ available: false, app: null, repositories: [], error: NO_GITHUB_APP });
      return Response.json({ error: NO_GITHUB_APP }, { status: 409 });
    }
    const copilot = COPILOTKIT.exec(url.pathname);
    if (copilot) {
      const name = copilot[1] as string;
      if (!this.known(name)) return Response.json({ error: "unknown project" }, { status: 404 });
      return (await this.copilot(name))(request);
    }
    const project = PROJECT.exec(url.pathname);
    if (project) {
      const name = project[1] as string;
      if (!this.known(name)) return Response.json({ error: `there is no project named ${name}` }, { status: 404 });
      return (await this.project(name)).request(request, project[2] as string);
    }
    const preview = PREVIEW.exec(url.pathname);
    if (preview && request.method === "GET") {
      const name = preview[1] as string;
      const key = preview[2] as string;
      if (!this.known(name)) return buildingPage({ status: "missing", key });
      const visit = await (await this.project(name)).preview(key, url.searchParams.has("retry"));
      if (visit.status === "ready") return new Response(null, { status: 302, headers: { location: `${visit.url.replace(/\/$/, "")}${previewPath(url.searchParams.get("path"))}`, "cache-control": "no-store" } });
      return buildingPage(visit.status === "failed" ? { status: "failed", key, error: visit.error } : { status: visit.status, key });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async settingsRequest(request: Request): Promise<Response> {
    if (request.method === "GET") return Response.json(this.settingsView());
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (body && "password" in body) return Response.json({ error: "chef on this computer has no password; only this computer can open it" }, { status: 409 });
    const result = applyUpdate(this.saved, body);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    this.saved = result.settings;
    writeAtomic(join(this.dir, "settings.json"), JSON.stringify(this.saved, null, 1));
    return Response.json(this.settingsView());
  }

  private async copilot(name: string): Promise<(request: Request) => Promise<Response>> {
    const existing = this.copilots.get(name);
    if (existing) return existing;
    const project = await this.project(name);
    const link: ChefLink = {
      cursor: () => project.bus.cursor(),
      submit: async (prompt) => {
        if (!this.settings().llm) throw new Error(NO_LLM);
        return project.submit(prompt);
      },
      events: (after) => project.bus.since(after),
    };
    const runtime = new CopilotRuntime({ agents: () => ({ default: new ChefAgent({ link, pollMs: 300 }) }) });
    const handler = createCopilotRuntimeHandler({ runtime, basePath: `/api/projects/${name}/copilotkit` });
    this.copilots.set(name, handler);
    return handler;
  }

  upgrade(incoming: IncomingMessage, socket: Duplex): boolean {
    const match = SOCKET.exec(new URL(incoming.url ?? "/", "http://localhost").pathname);
    const key = incoming.headers["sec-websocket-key"];
    if (!match || typeof key !== "string" || !this.known(match[1] as string)) return false;
    const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);
    this.sockets.add(socket);
    let stop: () => void = () => {};
    const end = () => {
      stop();
      this.sockets.delete(socket);
      socket.destroy();
    };
    socket.on("close", end);
    socket.on("error", end);
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const opcode = (pending[0] as number) & 0x0f;
        let length = (pending[1] as number) & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (pending.length < 4) return;
          length = pending.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (pending.length < 10) return;
          length = Number(pending.readBigUInt64BE(2));
          offset = 10;
        }
        const masked = ((pending[1] as number) & 0x80) !== 0;
        const total = offset + (masked ? 4 : 0) + length;
        if (pending.length < total) return;
        const mask = masked ? pending.subarray(offset, offset + 4) : null;
        const payload = Buffer.from(pending.subarray(total - length, total));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] as number) ^ (mask[i % 4] as number);
        pending = pending.subarray(total);
        if (opcode === 0x8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        if (opcode === 0x9) socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      }
    });
    void this.project(match[1] as string).then(async (project) => {
      let sent = 0;
      let replaying = true;
      const queued: LogEntry[] = [];
      const send = (entry: LogEntry) => {
        if (entry.seq <= sent) return;
        sent = entry.seq;
        socket.write(frame(JSON.stringify(entry)));
      };
      stop = project.watch((entry) => (replaying ? queued.push(entry) : send(entry)));
      for (let after = 0; ; ) {
        const entries = await project.bus.since(after);
        entries.forEach(send);
        const last = entries.at(-1);
        if (!last || entries.length < 500) break;
        after = last.seq;
      }
      replaying = false;
      queued.forEach(send);
    }, end);
    return true;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    for (const project of this.projects.values()) await (await project.catch(() => null))?.close();
    this.docker.removeLabelled("chef=sandbox");
    await this.git.close();
  }
}
