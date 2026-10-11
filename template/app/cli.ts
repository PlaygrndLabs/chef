import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Flow } from "../shared/flow.ts";
import { drive, type Fetcher } from "./drive.ts";
import { REGISTRY_PATH, renderRegistry } from "./gen.ts";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function featurePaths(): Promise<string[]> {
  const entries = await readdir(join(root, "features"), { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(join(root, "features", entry.name));
    for (const file of files) paths.push(`features/${entry.name}/${file}`);
  }
  return paths;
}

async function gen(check: boolean): Promise<number> {
  const expected = renderRegistry(await featurePaths());
  const target = join(root, REGISTRY_PATH);
  const actual = await readFile(target, "utf8").catch(() => "");
  if (actual === expected) return 0;
  if (check) {
    process.stderr.write(`${REGISTRY_PATH} is out of date; run \`app gen\`\n`);
    return 1;
  }
  await writeFile(target, expected);
  return 0;
}

async function flowFor(feature: string): Promise<Flow> {
  const spec = await readFile(join(root, "spec", "features", `${feature}.md`), "utf8").catch(() => "");
  const name = /^flow:\s*([a-z0-9-]+)\s*$/m.exec(spec)?.[1] ?? feature;
  const module = (await import(pathToFileURL(join(root, "features", name, "flow.ts")).href)) as { flow: Flow };
  return module.flow;
}

async function localFetcher(): Promise<Fetcher> {
  const module = (await import(pathToFileURL(join(root, "src", "index.ts")).href)) as { default: { fetch: (request: Request, env: object) => Promise<Response> } };
  return (request) => module.default.fetch(request, {});
}

async function runDrive(feature: string, args: readonly string[]): Promise<{ code: number; output: unknown }> {
  const url = option(args, "url");
  const flow = await flowFor(feature);
  const result = url ? await drive(flow, url) : await drive(flow, "http://local.test", await localFetcher());
  return { code: result.ok ? 0 : 1, output: result };
}

async function main(args: readonly string[]): Promise<number> {
  const [command, target] = args;
  if (command === "gen") return gen(args.includes("--check"));
  if ((command === "drive" || command === "proof") && target) {
    const { code, output } = await runDrive(target, args);
    const proof = command === "proof" ? { ...(output as object), commit: option(args, "commit") ?? null, at: new Date().toISOString() } : output;
    const out = option(args, "out");
    if (out) {
      await mkdir(dirname(resolve(out)), { recursive: true });
      await writeFile(resolve(out), `${JSON.stringify(proof, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    return code;
  }
  process.stderr.write("usage: app gen [--check] | app drive <feature> [--url URL] | app proof <feature> --url URL [--commit SHA] [--out FILE]\n");
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
