import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { createNodeFetchHandler } from "@copilotkit/runtime/v2/node";
import { checkCloudflare, deployFromHere, IDLE, readAccount, type CloudflareAccount, type Deployer, type SetupState } from "./cloudflare.ts";
import { REPO_ROOT } from "./world.ts";

export interface Connection {
  readonly url: string;
  readonly password: string;
}

export type Placement = { readonly place: "computer" } | ({ readonly place: "cloud" } & Connection);

export interface ConnectionStore {
  read(): Placement | null;
  write(placement: Placement): void;
  clear(): void;
  readonly fixed: boolean;
}

export function cloudOf(placement: Placement | null): Connection | null {
  return placement?.place === "cloud" ? { url: placement.url, password: placement.password } : null;
}

export function chefHome(): string {
  return process.env["CHEF_HOME"] ?? join(homedir(), ".chef");
}

function parsePlacement(stored: Partial<Connection> & { place?: unknown }): Placement | null {
  if (stored.place === "computer") return { place: "computer" };
  return typeof stored.url === "string" && typeof stored.password === "string" ? { place: "cloud", url: stored.url, password: stored.password } : null;
}

export function fileStore(home: string = chefHome(), env: NodeJS.ProcessEnv = process.env, forced: Placement | null = null): ConnectionStore {
  const file = join(home, "connection.json");
  const fixed = forced ?? (env["CHEF_URL"] && env["CHEF_PASSWORD"] ? { place: "cloud" as const, url: normalizeUrl(env["CHEF_URL"]), password: env["CHEF_PASSWORD"] } : null);
  return {
    fixed: fixed !== null,
    read: () => {
      if (fixed) return fixed;
      try {
        return parsePlacement(JSON.parse(readFileSync(file, "utf8")) as Partial<Connection>);
      } catch {
        return null;
      }
    },
    write: (placement) => {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(file, `${JSON.stringify(placement, null, 2)}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
    },
    clear: () => rmSync(file, { force: true }),
  };
}

export function memoryStore(initial: Placement | null = null): ConnectionStore {
  let current = initial;
  return {
    fixed: false,
    read: () => current,
    write: (placement) => {
      current = placement;
    },
    clear: () => {
      current = null;
    },
  };
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("use the https address of your chef");
  return url.origin;
}

export type ConnectResult = { readonly ok: true; readonly url: string; readonly claimed: boolean } | { readonly ok: false; readonly status: number; readonly error: string };

export async function connect(input: { readonly url: unknown; readonly password: unknown }, fetchImpl: typeof fetch = fetch): Promise<ConnectResult> {
  if (typeof input.url !== "string" || !input.url.trim()) return { ok: false, status: 400, error: "enter the address of your chef" };
  if (typeof input.password !== "string" || !input.password) return { ok: false, status: 400, error: "enter its password" };
  let url: string;
  try {
    url = normalizeUrl(input.url);
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error && error.message.startsWith("use") ? error.message : "that is not a web address" };
  }
  const password = input.password;
  const probe = () => fetchImpl(`${url}/api/settings`, { headers: { authorization: `Bearer ${password}` }, redirect: "manual" });
  let response: Response;
  try {
    response = await probe();
  } catch {
    return { ok: false, status: 502, error: `could not reach ${url}` };
  }
  let claimed = false;
  if (response.status === 503) {
    const body = new URLSearchParams({ password, confirm: password });
    const setup = await fetchImpl(`${url}/setup`, { method: "POST", body, redirect: "manual" });
    if (setup.status !== 303) {
      const page = await setup.text();
      const reason = /<p class="error">([^<]+)<\/p>/.exec(page)?.[1];
      return { ok: false, status: 400, error: reason ?? "this chef has no password yet and did not accept that one" };
    }
    claimed = true;
    response = await probe();
  }
  if (response.status === 401) return { ok: false, status: 401, error: "wrong password" };
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("application/json")) return { ok: false, status: 502, error: `${url} did not answer like a chef (${response.status})` };
  return { ok: true, url, claimed };
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const PROXIED = /^\/(?:api|agents|preview)\//;
const DROP_REQUEST = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "cookie", "origin", "referer", "authorization", "accept-encoding", "content-length"]);
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie", "strict-transport-security"]);

export interface LocalApp {
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

export interface LocalEngineLike {
  handle(request: Request): Promise<Response>;
  upgrade(incoming: IncomingMessage, socket: Duplex): boolean;
  close(): Promise<void>;
}

export interface ComputerState {
  readonly status: "off" | "starting" | "ready" | "failed";
  readonly log: readonly string[];
  readonly error: string | null;
}

export interface AppOptions {
  readonly port: number;
  readonly startEngine?: (log: (line: string) => void) => Promise<LocalEngineLike>;
  readonly dockerProblem?: () => string | null;
  readonly deployer?: Deployer;
  readonly host?: string;
  readonly store?: ConnectionStore;
  readonly assets?: string;
  readonly fetchImpl?: typeof fetch;
}

const FIXED = "this app's place is set when it starts (by --local, or by CHEF_URL and CHEF_PASSWORD)";
const TAIL = 14;

export async function startApp(options: AppOptions): Promise<LocalApp> {
  const store = options.store ?? fileStore();
  const assets = options.assets ?? join(REPO_ROOT, "apps", "dashboard", "dist");
  const fetchImpl = options.fetchImpl ?? fetch;
  const bind = options.host ?? "127.0.0.1";
  let origins = new Set<string>();
  let hosts = new Set<string>();

  const trusted = (request: Request): boolean => {
    if (!hosts.has(request.headers.get("host") ?? "")) return false;
    const origin = request.headers.get("origin");
    if (origin !== null && !origins.has(origin)) return false;
    const site = request.headers.get("sec-fetch-site");
    if (request.method !== "GET" && request.method !== "HEAD") return origin !== null ? true : site === "same-origin";
    return site === null || site === "same-origin" || site === "none" || !PROXIED.test(new URL(request.url).pathname);
  };

  let engine: LocalEngineLike | null = null;
  let computer: ComputerState = { status: "off", log: [], error: null };
  let setup: SetupState = IDLE;
  let dockerChecked: { at: number; problem: string | null } | null = null;
  const dockerProblem = () => {
    if (!options.dockerProblem) return "this app was started without a local engine";
    if (!dockerChecked || Date.now() - dockerChecked.at > 10_000) dockerChecked = { at: Date.now(), problem: options.dockerProblem() };
    return dockerChecked.problem;
  };

  let generation = 0;
  const startComputer = () => {
    if (engine || computer.status === "starting") return;
    const start = options.startEngine;
    if (!start) {
      computer = { status: "failed", log: [], error: "this app was started without a local engine" };
      return;
    }
    const log = (line: string) => {
      computer = { ...computer, log: [...computer.log, line].slice(-TAIL) };
    };
    computer = { status: "starting", log: [], error: null };
    const run = ++generation;
    start(log).then(
      (started) => {
        if (run !== generation) return void started.close();
        engine = started;
        computer = { ...computer, status: "ready" };
      },
      (error: unknown) => {
        if (run !== generation) return;
        computer = { ...computer, status: "failed", error: error instanceof Error ? error.message : String(error) };
      },
    );
  };

  const stopComputer = async () => {
    generation++;
    const running = engine;
    engine = null;
    computer = { status: "off", log: [], error: null };
    await running?.close();
  };

  if (store.read()?.place === "computer") startComputer();

  const view = (extra: Record<string, unknown> = {}) => {
    const placement = store.read();
    return { mode: "local", place: placement?.place ?? null, engine: cloudOf(placement)?.url ?? null, fixed: store.fixed, computer, docker: placement ? null : dockerProblem(), setup, ...extra };
  };

  const deployToCloudflare = (account: CloudflareAccount, password: string) => {
    const deployer = options.deployer ?? deployFromHere;
    const log = (line: string) => {
      setup = { ...setup, log: [...setup.log, line].slice(-TAIL) };
    };
    setup = { status: "running", log: [], url: null, error: null };
    deployer(account, { CHEF_PASSWORD: password, CF_ACCOUNT_ID: account.accountId, CF_API_TOKEN: account.apiToken }, log)
      .then(async (deployed) => {
        if (deployed.code !== 0 || !deployed.url) throw new Error(`the deploy failed: ${setup.log.slice(-3).join(" ")}`);
        log(`chef is live at ${deployed.url}; connecting`);
        let result: ConnectResult = { ok: false, status: 502, error: "not tried" };
        for (let attempt = 0; attempt < 20; attempt++) {
          result = await connect({ url: deployed.url, password }, fetchImpl);
          if (result.ok || result.status === 401) break;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        if (!result.ok) throw new Error(`chef is live at ${deployed.url} but connecting failed: ${result.error}`);
        await stopComputer();
        store.write({ place: "cloud", url: result.url, password });
        setup = { ...setup, status: "done", url: result.url };
      })
      .catch((error: unknown) => {
        setup = { ...setup, status: "failed", error: error instanceof Error ? error.message : String(error) };
      });
  };

  const appRequest = async (request: Request, path: string): Promise<Response> => {
    if (path === "/api/app" && request.method === "GET") return Response.json(view());
    if (store.fixed && request.method !== "GET" && path !== "/api/app/cloudflare/check") return Response.json({ error: FIXED }, { status: 409 });
    const body = request.method === "GET" || request.method === "DELETE" ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    if (path === "/api/app/place" && request.method === "PUT") {
      if (body["place"] !== "computer") return Response.json({ error: "to work on Cloudflare, connect to your chef there or set one up" }, { status: 400 });
      dockerChecked = null;
      const problem = dockerProblem();
      if (problem) return Response.json({ error: problem }, { status: 409 });
      store.write({ place: "computer" });
      startComputer();
      return Response.json(view());
    }
    if (path === "/api/app/connection" && request.method === "PUT") {
      const result = await connect({ url: body["url"], password: body["password"] }, fetchImpl);
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      await stopComputer();
      store.write({ place: "cloud", url: result.url, password: body["password"] as string });
      return Response.json(view({ claimed: result.claimed }));
    }
    if (path === "/api/app/connection" && request.method === "DELETE") {
      await stopComputer();
      store.clear();
      setup = IDLE;
      return Response.json(view());
    }
    if (path === "/api/app/cloudflare/check" && request.method === "POST") {
      const account = readAccount(body);
      if (typeof account === "string") return Response.json({ error: account }, { status: 400 });
      const checked = await checkCloudflare(account, fetchImpl);
      return checked.ok ? Response.json(checked) : Response.json({ error: checked.error }, { status: 400 });
    }
    if (path === "/api/app/cloudflare/deploy" && request.method === "POST") {
      const account = readAccount(body);
      if (typeof account === "string") return Response.json({ error: account }, { status: 400 });
      const password = typeof body["password"] === "string" ? body["password"] : "";
      if (password.length < 8) return Response.json({ error: "pick a password of at least 8 characters for your chef in Cloudflare" }, { status: 400 });
      if (setup.status === "running") return Response.json({ error: "a deploy is already running" }, { status: 409 });
      if (!options.deployer) {
        const problem = dockerProblem();
        if (problem) return Response.json({ error: `${problem} Deploying from this app builds the sandbox image with Docker; without Docker, use the Deploy to Cloudflare button.` }, { status: 409 });
      }
      deployToCloudflare(account, password);
      return Response.json(view(), { status: 202 });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };

  const proxy = async (request: Request, connection: Connection): Promise<Response> => {
    const url = new URL(request.url);
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (!DROP_REQUEST.has(key)) headers.set(key, value);
    });
    headers.set("authorization", `Bearer ${connection.password}`);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const settingsChange = url.pathname === "/api/settings" && request.method === "PUT";
    const body = settingsChange ? await request.text() : hasBody ? request.body : null;
    let upstream: Response;
    try {
      upstream = await fetchImpl(`${connection.url}${url.pathname}${url.search}`, { method: request.method, headers, redirect: "manual", ...(body !== null ? { body, duplex: "half" } : {}) } as RequestInit);
    } catch {
      return Response.json({ error: `could not reach your chef at ${connection.url}` }, { status: 502 });
    }
    if (settingsChange && upstream.ok && !store.fixed) {
      const changed = (parse(String(body)) as { password?: unknown } | null)?.password;
      if (typeof changed === "string") store.write({ place: "cloud", ...connection, password: changed });
    }
    const out = new Headers();
    upstream.headers.forEach((value, key) => {
      if (DROP_RESPONSE.has(key)) return;
      if (key === "location" && value.startsWith(connection.url)) out.set(key, value.slice(connection.url.length) || "/");
      else out.set(key, value);
    });
    return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  };

  const file = (path: string): Response => {
    const clean = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
    const candidate = join(assets, clean);
    const target = candidate.startsWith(assets) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : extname(clean) ? null : join(assets, "index.html");
    if (!target || !existsSync(target)) return new Response(existsSync(join(assets, "index.html")) ? "not found" : "The app is not built yet: run pnpm build", { status: 404 });
    return new Response(readFileSync(target), { headers: { "content-type": TYPES[extname(target)] ?? "application/octet-stream", "cache-control": target.endsWith("index.html") ? "no-store" : "public, max-age=3600" } });
  };

  const handle = async (request: Request): Promise<Response> => {
    if (!trusted(request)) return Response.json({ error: "chef only answers its own pages" }, { status: 403 });
    const path = new URL(request.url).pathname;
    if (path === "/api/app" || path.startsWith("/api/app/")) return appRequest(request, path);
    if (PROXIED.test(path)) {
      const placement = store.read();
      if (placement?.place === "computer") return engine ? engine.handle(request) : Response.json({ error: computer.error ?? "chef is still starting on this computer" }, { status: 503 });
      const connection = cloudOf(placement);
      if (!connection) return Response.json({ error: "choose where chef works first" }, { status: 503 });
      return proxy(request, connection);
    }
    return file(path);
  };

  const server = createServer(createNodeFetchHandler(handle));
  const tunnels = new Set<Duplex>();
  server.on("upgrade", (incoming: IncomingMessage, socket: Duplex, head: Buffer) => {
    tunnels.add(socket);
    socket.on("close", () => tunnels.delete(socket));
    const placement = store.read();
    const connection = cloudOf(placement);
    const origin = incoming.headers.origin;
    if (placement?.place === "computer") {
      if (!engine || !hosts.has(incoming.headers.host ?? "") || (origin !== undefined && !origins.has(origin)) || !engine.upgrade(incoming, socket)) socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
      return;
    }
    if (!connection || !hosts.has(incoming.headers.host ?? "") || (origin !== undefined && !origins.has(origin)) || !(incoming.url ?? "").startsWith("/agents/")) {
      socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
      return;
    }
    tunnel(incoming, socket, head, connection);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, bind, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(bind !== "127.0.0.1" ? [`${bind}:${port}`] : [])]);
  origins = new Set([...hosts].map((h) => `http://${h}`));
  return {
    url: `http://localhost:${port}`,
    server,
    close: async () => {
      await new Promise<void>((resolve) => {
        for (const socket of tunnels) socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      });
      await stopComputer();
    },
  };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tunnel(incoming: IncomingMessage, socket: Duplex, head: Buffer, connection: Connection): void {
  const target = new URL(`${connection.url}${incoming.url ?? "/"}`);
  const headers: Record<string, string> = { host: target.host, connection: "Upgrade", upgrade: "websocket", authorization: `Bearer ${connection.password}` };
  for (const name of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions"]) {
    const value = incoming.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, { method: "GET", headers });
  request.on("upgrade", (response, upstream, upstreamHead) => {
    const lines = [`HTTP/1.1 101 ${response.statusMessage ?? "Switching Protocols"}`];
    for (let i = 0; i < response.rawHeaders.length; i += 2) lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", close);
    socket.on("error", close);
    upstream.on("close", close);
    socket.on("close", close);
  });
  request.on("response", (response) => {
    socket.end(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ""}\r\nconnection: close\r\n\r\n`);
    response.resume();
  });
  request.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n"));
  request.end();
}
