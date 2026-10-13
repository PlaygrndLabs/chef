import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./world.ts";

export const BASE_NAME = "chef";
export const MEMORY_DIMENSIONS = 768;

type Json = Record<string, unknown>;

export function parseJsonc(text: string): Json {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i === 0) break;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Json;
}

const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

export function instanceConfig(base: Json, name: string): Json {
  if (name === base["name"]) return base;
  const workflows = new Map(list(base["workflows"]).map((w) => [String(w["name"]), `${name}-${String(w["name"])}`]));
  const namespace = (n: unknown) => (n === BASE_NAME ? name : n);
  const triggers = base["triggers"] as Json | undefined;
  return {
    ...base,
    name,
    artifacts: list(base["artifacts"]).map((a) => ({ ...a, namespace: namespace(a["namespace"]) })),
    workflows: list(base["workflows"]).map((w) => ({ ...w, name: workflows.get(String(w["name"])) })),
    vectorize: list(base["vectorize"]).map((v) => ({ ...v, index_name: `${name}-memory` })),
    ...(triggers
      ? {
          triggers: {
            ...triggers,
            events: list(triggers["events"]).map((e) => ({
              ...e,
              filter: { ...(e["filter"] as Json), namespace: namespace((e["filter"] as Json | undefined)?.["namespace"]) },
              targets: list(e["targets"]).map((t) => ({ ...t, workflow_name: workflows.get(String(t["workflow_name"])) ?? t["workflow_name"] })),
            })),
          },
        }
      : {}),
    vars: { ...(base["vars"] as Json), PROJECT_WORKER_PREFIX: `${name}-` },
  };
}

export function movedConfig(base: Json, name: string, from: string): Json {
  const [script, tag] = from.split("@") as [string, string | undefined];
  const migrations = list(base["migrations"]);
  const at = migrations.findIndex((m) => m["tag"] === tag);
  if (!script || at < 0) throw new Error(`--moved-from needs <worker>@<last migration tag>, such as chef@${String(migrations.at(-1)?.["tag"] ?? "v1")}`);
  const classes = migrations.slice(0, at + 1).flatMap((m) => [...list(m["new_sqlite_classes"]), ...list(m["new_classes"])] as unknown as string[]);
  const workflows = new Map(list(base["workflows"]).map((w) => [String(w["name"]), `${name}-${String(w["name"])}`]));
  const triggers = base["triggers"] as Json | undefined;
  return {
    ...base,
    name,
    migrations: [{ tag, transferred_classes: classes.map((cls) => ({ from: cls, from_script: script, to: cls })) }, ...migrations.slice(at + 1)],
    workflows: list(base["workflows"]).map((w) => ({ ...w, name: workflows.get(String(w["name"])) })),
    ...(triggers
      ? { triggers: { ...triggers, events: list(triggers["events"]).map((e) => ({ ...e, targets: list(e["targets"]).map((t) => ({ ...t, workflow_name: workflows.get(String(t["workflow_name"])) ?? t["workflow_name"] })) })) } }
      : {}),
  };
}

export function withImage(config: Json, image: string): Json {
  return {
    ...config,
    containers: list(config["containers"]).map((c) => ({ ...c, images: Object.fromEntries(Object.keys((c["images"] as Json | undefined) ?? { coder: null }).map((key) => [key, { image }])) })),
  };
}

export interface Run {
  readonly code: number;
  readonly output: string;
}

export type Runner = (args: readonly string[], options?: { readonly echo?: boolean }) => Promise<Run>;

export function wranglerRunner(cwd: string = REPO_ROOT, setup: { readonly env?: Readonly<Record<string, string>>; readonly onLine?: (line: string) => void } = {}): Runner {
  const bin = join(REPO_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  return (args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, ...setup.env }, stdio: [setup.onLine ? "ignore" : "inherit", "pipe", "pipe"] });
      let output = "";
      let pending = "";
      const take = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
        output += chunk.toString();
        if (setup.onLine && options?.echo) {
          pending += chunk.toString();
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) setup.onLine(line);
        } else if (options?.echo) stream.write(chunk);
      };
      child.stdout.on("data", take(process.stdout));
      child.stderr.on("data", take(process.stderr));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, output }));
    });
}

export async function ensureMemoryIndex(run: Runner, index: string, log: (line: string) => void): Promise<void> {
  if ((await run(["vectorize", "get", index])).code === 0) return;
  const created = await run(["vectorize", "create", index, `--dimensions=${MEMORY_DIMENSIONS}`, "--metric=cosine"]);
  if (created.code === 0) log(`created the memory index ${index}`);
  else log(`could not check or create the memory index ${index}; deploying anyway:\n${created.output.trim().split("\n").slice(-3).join("\n")}`);
}

export interface DeployOptions {
  readonly name?: string;
  readonly image?: string;
  readonly movedFrom?: string;
  readonly dryRun?: boolean;
  readonly passthrough?: readonly string[];
  readonly run?: Runner;
  readonly log?: (line: string) => void;
}

export interface Deployed {
  readonly code: number;
  readonly url: string | null;
  readonly config: string;
}

export async function deploy(options: DeployOptions = {}): Promise<Deployed> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const run = options.run ?? wranglerRunner();
  const baseFile = join(REPO_ROOT, "wrangler.jsonc");
  const base = parseJsonc(readFileSync(baseFile, "utf8"));
  const name = options.name ?? String(base["name"]);
  let config = baseFile;
  if (name !== base["name"] || options.image) {
    config = join(REPO_ROOT, `.wrangler.${name}.jsonc`);
    const instance = options.movedFrom ? movedConfig(base, name, options.movedFrom) : instanceConfig(base, name);
    writeFileSync(config, `${JSON.stringify(options.image ? withImage(instance, options.image) : instance, null, 2)}\n`);
    if (options.movedFrom) log(`deploying chef as ${name}, keeping the projects, repos and memory of ${options.movedFrom.split("@")[0]}`);
    else if (name !== base["name"]) log(`deploying a separate chef named ${name}, with its own repos, memory and previews`);
    if (options.image) log(`using the prebuilt sandbox image ${options.image}`);
  }
  const index = (list(parseJsonc(readFileSync(config, "utf8"))["vectorize"])[0]?.["index_name"] as string | undefined) ?? null;
  if (index && !options.dryRun) await ensureMemoryIndex(run, index, log);
  const args = ["deploy", "--config", config, ...(options.dryRun ? ["--dry-run", "--outdir", join(REPO_ROOT, "dist", "worker")] : []), ...(options.passthrough ?? [])];
  mkdirSync(join(REPO_ROOT, "dist"), { recursive: true });
  let result = await run(args, { echo: true });
  if (result.code !== 0 && options.movedFrom && !options.dryRun && result.output.includes("10074")) {
    log(`moving the Durable Objects first, then turning on the sandbox containers`);
    const first = join(REPO_ROOT, `.wrangler.${name}.move.jsonc`);
    const { containers: _containers, ...withoutContainers } = parseJsonc(readFileSync(config, "utf8"));
    writeFileSync(first, `${JSON.stringify(withoutContainers, null, 2)}\n`);
    const moved = await run(["deploy", "--config", first, ...(options.passthrough ?? [])], { echo: true });
    result = moved.code === 0 ? await run(args, { echo: true }) : moved;
  }
  if (result.code !== 0 && !options.dryRun && result.output.includes("could not finish applying")) {
    log(`finishing the sandbox container settings`);
    result = await run(args, { echo: true });
  }
  const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(result.output)?.[0] ?? null;
  if (result.code === 0 && url) log(`\nchef is live at ${url}\nOpen it in a browser, or connect the local app to it with: pnpm start`);
  return { code: result.code, url, config };
}
