import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newToken } from "@chef/core/access";
import { REPO_ROOT } from "./world.ts";

export const BASE_NAME = "chef";
export const MEMORY_DIMENSIONS = 768;
export const TRANSCRIPTS_BINDING = "TRANSCRIPTS";
export const TRANSCRIPT_DAYS = 90;

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

export const DEFAULT_MEMORY_INDEX = `${BASE_NAME}-memory`;

export function instanceConfig(base: Json, name: string): Json {
  if (name === BASE_NAME && base["name"] === BASE_NAME) return base;
  const workflows = new Map(list(base["workflows"]).map((w) => [String(w["name"]), `${name}-${String(w["name"])}`]));
  const namespace = (n: unknown) => (n === BASE_NAME ? name : n);
  const triggers = base["triggers"] as Json | undefined;
  return {
    ...base,
    name,
    artifacts: list(base["artifacts"]).map((a) => ({ ...a, namespace: namespace(a["namespace"]) })),
    workflows: list(base["workflows"]).map((w) => ({ ...w, name: workflows.get(String(w["name"])) })),
    vectorize: list(base["vectorize"]).map((v) => ({ ...v, index_name: v["index_name"] === DEFAULT_MEMORY_INDEX ? `${name}-memory` : v["index_name"] })),
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

export function wranglerRunner(cwd: string = REPO_ROOT): Runner {
  const bin = join(REPO_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  return (args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], { cwd, stdio: ["inherit", "pipe", "pipe"] });
      let output = "";
      const take = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
        output += chunk.toString();
        if (options?.echo) stream.write(chunk);
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

export async function ensureTranscripts(run: Runner, bucket: string, log: (line: string) => void): Promise<boolean> {
  if ((await run(["r2", "bucket", "info", bucket])).code === 0) return true;
  const created = await run(["r2", "bucket", "create", bucket]);
  if (created.code !== 0) {
    log(`could not check or create the transcript bucket ${bucket}, so Chef keeps no copy of its coders' Claude transcripts:\n${created.output.trim().split("\n").slice(-3).join("\n")}`);
    return false;
  }
  const rule = await run(["r2", "bucket", "lifecycle", "add", bucket, "expire-transcripts", "--expire-days", String(TRANSCRIPT_DAYS), "--force"]);
  log(rule.code === 0 ? `created the transcript bucket ${bucket}, which deletes a transcript after ${TRANSCRIPT_DAYS} days` : `created the transcript bucket ${bucket}, but could not make it delete transcripts after ${TRANSCRIPT_DAYS} days`);
  return true;
}

export function transcriptBucket(name: string): string {
  return `${name.slice(0, 63 - "-transcripts".length)}-transcripts`;
}

export function withTranscripts(config: Json, bucket: string): Json {
  return { ...config, r2_buckets: [...list(config["r2_buckets"]).filter((b) => b["binding"] !== TRANSCRIPTS_BINDING), { binding: TRANSCRIPTS_BINDING, bucket_name: bucket }] };
}

export const TOKEN_HELP =
  "Cloudflare refused this deploy's API token. Chef needs a token that can edit Workers Scripts, Containers, Artifacts and Vectorize, and optionally Workers R2 Storage to keep its coders' transcripts. " +
  "On a Deploy to Cloudflare button or Workers Builds deploy, open your Worker's Settings > Builds to see which token the build uses, " +
  "add those permissions to it under My Profile > API Tokens, then retry the build.";

export function refusedToken(output: string): boolean {
  return /unauthorized|authentication error|not authorized|\b(code: ?10000|status 403)\b/i.test(output);
}

export interface DeployOptions {
  readonly name?: string;
  readonly image?: string;
  readonly dryRun?: boolean;
  readonly apiKey?: boolean;
  readonly passthrough?: readonly string[];
  readonly run?: Runner;
  readonly log?: (line: string) => void;
}

export interface Deployed {
  readonly code: number;
  readonly url: string | null;
  readonly config: string;
  readonly apiKey: string | null;
}

export function withSecret(args: readonly string[], name: string, value: string, dir: string): string[] {
  const at = args.findIndex((arg) => arg === "--secrets-file" || arg.startsWith("--secrets-file="));
  const given = at < 0 ? null : args[at]?.startsWith("--secrets-file=") ? (args[at] as string).slice("--secrets-file=".length) : (args[at + 1] ?? null);
  const secrets = given ? (JSON.parse(readFileSync(given, "utf8")) as Record<string, string>) : {};
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify({ ...secrets, [name]: value }), { mode: 0o600 });
  const rest = at < 0 ? [...args] : [...args.slice(0, at), ...args.slice(at + (args[at]?.includes("=") ? 1 : 2))];
  return [...rest, "--secrets-file", file];
}

export async function deploy(options: DeployOptions = {}): Promise<Deployed> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const run = options.run ?? wranglerRunner();
  const baseFile = join(REPO_ROOT, "wrangler.jsonc");
  const base = parseJsonc(readFileSync(baseFile, "utf8"));
  const name = options.name ?? String(base["name"]);
  let instance: Json | null = null;
  if (name !== BASE_NAME || options.image) {
    instance = options.image ? withImage(instanceConfig(base, name), options.image) : instanceConfig(base, name);
    if (name !== BASE_NAME) log(`deploying a separate chef named ${name}, with its own repos, memory and app router`);
    if (options.image) log(`using the prebuilt sandbox image ${options.image}`);
  }
  const bucket = transcriptBucket(name);
  if (!options.dryRun && (await ensureTranscripts(run, bucket, log))) instance = withTranscripts(instance ?? base, bucket);
  let config = baseFile;
  if (instance) {
    config = join(REPO_ROOT, `.wrangler.${name}.jsonc`);
    writeFileSync(config, `${JSON.stringify(instance, null, 2)}\n`);
  }
  const index = (list((instance ?? base)["vectorize"])[0]?.["index_name"] as string | undefined) ?? null;
  if (index && !options.dryRun) await ensureMemoryIndex(run, index, log);
  const apiKey = options.apiKey && !options.dryRun ? newToken().token : null;
  const secretsDir = apiKey ? mkdtempSync(join(tmpdir(), "chef-deploy-")) : null;
  const passthrough = apiKey && secretsDir ? withSecret(options.passthrough ?? [], "CHEF_API_KEY", apiKey, secretsDir) : [...(options.passthrough ?? [])];
  const args = ["deploy", "--config", config, ...(options.dryRun ? ["--dry-run", "--outdir", join(REPO_ROOT, "dist", "worker")] : []), ...passthrough];
  mkdirSync(join(REPO_ROOT, "dist"), { recursive: true });
  let result: Run;
  try {
    result = await run(args, { echo: true });
    if (result.code !== 0 && !options.dryRun && result.output.includes("could not finish applying")) {
      log(`finishing the sandbox container settings`);
      result = await run(args, { echo: true });
    }
  } finally {
    if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
  }
  if (result.code !== 0 && !options.dryRun && refusedToken(result.output)) log(`\n${TOKEN_HELP}`);
  const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(result.output)?.[0] ?? null;
  if (result.code === 0 && url) log(`\nchef is live at ${url}\n${apiKey ? "It answers the new API key, which replaces any key an earlier deploy made." : "Open it in a browser."}`);
  return { code: result.code, url, config, apiKey: result.code === 0 ? apiKey : null };
}
