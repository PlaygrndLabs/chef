import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "../world.ts";

export const SANDBOX_DIR = join(REPO_ROOT, "workers", "sandbox");
export const SYSTEM_CA = "/etc/ssl/certs/ca-certificates.crt";
const EXTRA_CA = "/etc/chef/extra-ca.crt";
const PROXY_VARS = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"];

export type Network = "bridge" | "host";

export interface DockerOptions {
  readonly repos: string;
  readonly network?: Network;
  readonly image?: string;
  readonly docker?: string;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunInput {
  readonly script: "runner.mjs" | "checks.mjs";
  readonly job: object;
  readonly name: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly onLine?: (line: string) => void;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

function files(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name !== "node_modules")
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    })
    .sort();
}

export function sandboxImage(): string {
  const hash = createHash("sha256");
  for (const file of files(SANDBOX_DIR)) hash.update(relative(SANDBOX_DIR, file)).update("\0").update(readFileSync(file)).update("\0");
  return `chef-sandbox:${hash.digest("hex").slice(0, 12)}`;
}

function extraCa(): string | null {
  for (const name of ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) {
    const file = process.env[name];
    if (file && existsSync(file)) return file;
  }
  return null;
}

export class Docker {
  readonly image: string;
  readonly network: Network;
  readonly bin: string;
  private ready: Promise<void> | null = null;

  constructor(readonly options: DockerOptions) {
    this.image = options.image ?? sandboxImage();
    this.network = options.network ?? "bridge";
    this.bin = options.docker ?? "docker";
  }

  available(): string | null {
    const result = spawnSync(this.bin, ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
    if (result.error) return `chef runs agents in Docker, and the docker command was not found. Install Docker Desktop or Docker Engine, start it, and run this again.`;
    if (result.status !== 0) return `chef runs agents in Docker, and Docker is not running: ${(result.stderr || result.stdout).trim().slice(0, 300)}`;
    return null;
  }

  prepare(log: (line: string) => void = () => {}): Promise<void> {
    this.ready ??= this.build(log).catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async build(log: (line: string) => void): Promise<void> {
    if (this.network === "bridge" && spawnSync(this.bin, ["network", "inspect", "chef"], { stdio: "ignore" }).status !== 0) spawnSync(this.bin, ["network", "create", "chef"], { stdio: "ignore" });
    if (spawnSync(this.bin, ["image", "inspect", this.image], { stdio: "ignore" }).status === 0) return;
    log(`building the sandbox image ${this.image} once; this takes a few minutes`);
    const proxies = PROXY_VARS.filter((name) => process.env[name]).flatMap((name) => ["--build-arg", name]);
    const result = await this.exec(["build", ...(this.network === "host" ? ["--network", "host"] : []), ...proxies, "-t", this.image, SANDBOX_DIR], { onLine: (line) => log(`  ${line}`) });
    if (result.code !== 0) throw new Error(`building the sandbox image failed: ${result.stderr.slice(-2000)}`);
    const [repository] = this.image.split(":");
    const older = spawnSync(this.bin, ["images", repository as string, "--format", "{{.Repository}}:{{.Tag}}"], { encoding: "utf8" }).stdout.split("\n").filter((tag) => tag && tag !== this.image && /:[0-9a-f]{12}$/.test(tag));
    if (older.length) spawnSync(this.bin, ["rmi", ...older], { stdio: "ignore" });
  }

  containerEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { ...extra, GIT_SSL_CAINFO: SYSTEM_CA, SSL_CERT_FILE: SYSTEM_CA, NODE_EXTRA_CA_CERTS: extraCa() ? EXTRA_CA : SYSTEM_CA };
  }

  runArgs(input: { readonly name: string; readonly env: Readonly<Record<string, string>>; readonly publish?: number; readonly detach?: boolean; readonly labels?: readonly string[] }): string[] {
    const ca = extraCa();
    const env = this.containerEnv(input.env);
    return [
      "run",
      ...(input.detach ? ["-d"] : ["--rm", "-i"]),
      "--name",
      input.name,
      ...["chef=sandbox", ...(input.labels ?? [])].flatMap((label) => ["--label", label]),
      "--network",
      this.network === "host" ? "host" : "chef",
      ...(this.network === "bridge" ? ["--add-host", "host.docker.internal:host-gateway"] : []),
      ...(input.publish && this.network === "bridge" ? ["-p", `127.0.0.1:${input.publish}:8787`] : []),
      "-v",
      `${this.options.repos}:/repos:ro`,
      ...(ca ? ["-v", `${ca}:${EXTRA_CA}:ro`] : []),
      ...Object.keys(env).flatMap((key) => ["-e", key]),
      ...PROXY_VARS.filter((name) => process.env[name] && !(name in env)).flatMap((name) => ["-e", name]),
      this.image,
    ];
  }

  async run(input: RunInput): Promise<RunResult> {
    await this.prepare();
    const env = { ...input.env, CHEF_JOB: Buffer.from(JSON.stringify(input.job)).toString("base64") };
    return this.exec([...this.runArgs({ name: input.name, env }), "node", `/opt/chef/${input.script}`], { env: this.containerEnv(env), ...(input.onLine ? { onLine: input.onLine } : {}), ...(input.signal ? { signal: input.signal } : {}), timeoutMs: input.timeoutMs ?? 30 * 60_000, name: input.name });
  }

  remove(name: string): void {
    spawnSync(this.bin, ["rm", "-f", name], { stdio: "ignore" });
  }

  removeLabelled(label: string): void {
    const ids = spawnSync(this.bin, ["ps", "-aq", "--filter", `label=${label}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    if (ids.length) spawnSync(this.bin, ["rm", "-f", ...ids], { stdio: "ignore" });
  }

  runningWith(prefix: string): boolean {
    return spawnSync(this.bin, ["ps", "-q", "--filter", `name=^${prefix}`], { encoding: "utf8" }).stdout.trim() !== "";
  }

  running(name: string): boolean {
    return spawnSync(this.bin, ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" }).stdout.trim() === "true";
  }

  exec(args: readonly string[], options: { readonly env?: Readonly<Record<string, string>>; readonly onLine?: (line: string) => void; readonly signal?: AbortSignal; readonly timeoutMs?: number; readonly name?: string } = {}): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn(this.bin, args, { env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let pending = "";
      const stop = () => {
        if (options.name) this.remove(options.name);
        child.kill("SIGKILL");
      };
      const timer = setTimeout(stop, options.timeoutMs ?? 10 * 60_000);
      options.signal?.addEventListener("abort", stop, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout = `${stdout}${text}`.slice(-4 * 1024 * 1024);
        if (!options.onLine) return;
        pending += text;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) if (line) options.onLine(line);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString("utf8")}`.slice(-64 * 1024);
      });
      const done = (code: number) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", stop);
        if (pending && options.onLine) options.onLine(pending);
        resolve({ code, stdout, stderr });
      };
      child.on("close", (code) => done(code ?? 1));
      child.on("error", (error) => {
        stderr += error.message;
        done(1);
      });
    });
  }
}
