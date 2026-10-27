import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Flow } from "../shared/flow.ts";
import { routeClashes, type Feature } from "../shared/http.ts";
import { shellHtml } from "../shared/http.ts";
import { FONTS_PATH } from "../shared/fonts.ts";
import { isPage } from "../shared/paths.ts";
import { closeBrowser } from "./browser.ts";
import { appFonts, bundleClient, listed, pageMetas } from "./client.ts";
import { drive, type Fetcher } from "./drive.ts";
import { lookAt } from "./look.ts";
import { referenceOf, summary, uploadAddress } from "./ref.ts";
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

async function registered(): Promise<readonly Feature[] | null> {
  const registry = await import(pathToFileURL(join(root, REGISTRY_PATH)).href).catch(() => null);
  return registry ? (registry as { features: readonly Feature[] }).features : null;
}

async function clashes(): Promise<string[]> {
  const features = await registered();
  return features ? routeClashes(features) : [];
}

async function gen(check: boolean): Promise<number> {
  const expected = renderRegistry(await featurePaths());
  const target = join(root, REGISTRY_PATH);
  const actual = await readFile(target, "utf8").catch(() => "");
  if (actual !== expected) {
    if (check) {
      process.stderr.write(`${REGISTRY_PATH} is out of date; run \`app gen\`\n`);
      return 1;
    }
    await writeFile(target, expected);
  }
  const found = await clashes();
  if (!found.length) return 0;
  process.stderr.write(`routes clash, so one feature would answer requests meant for another:\n${found.map((clash) => `  ${clash}\n`).join("")}give each route its own method and path\n`);
  return 1;
}

async function writePages(out: string): Promise<void> {
  try {
    const served = ((await registered()) ?? []).flatMap((feature) => feature.routes.filter((route) => route.method === "GET").map((route) => route.path));
    for (const [path, meta] of await pageMetas(root, served)) {
      const file = join(out, path === "/" ? "index.html" : `${path.slice(1)}.html`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, shellHtml(meta));
    }
  } catch (error) {
    process.stderr.write(`page titles for link previews were skipped, so every page opens with the plain shell: ${(error as Error).message}\n`);
  }
}

async function writeFonts(out: string): Promise<void> {
  let css = "";
  try {
    const fonts = await appFonts(root);
    await mkdir(join(out, "fonts"), { recursive: true });
    for (const [file, source] of fonts.files) await copyFile(source, join(out, "fonts", file));
    css = fonts.css;
  } catch (error) {
    process.stderr.write(`the app's fonts were skipped, so pages use the system fonts: ${(error as Error).message}\n`);
  }
  await writeFile(join(out, FONTS_PATH.slice(1)), css);
}

async function build(): Promise<number> {
  try {
    const code = await bundleClient(root);
    const out = join(root, "dist", "client");
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "client.js"), code);
    await writePages(out);
    await writeFonts(out);
    return 0;
  } catch (error) {
    process.stderr.write(`building the pages failed:\n${(error as Error).message}\n`);
    return 1;
  }
}

async function look(args: readonly string[]): Promise<number> {
  const wanted = option(args, "features")?.split(",").filter(Boolean);
  const { pages, look } = await listed(root);
  const named = args.slice(1).filter((arg, i, all) => arg.startsWith("/") && all[i - 1] !== "--out");
  const paths = named.length ? named : [...new Set(pages.filter((page) => (!wanted || wanted.includes(page.feature)) && (page.path === "/" || isPage({ method: "GET", path: page.path }))).map((page) => page.path))];
  try {
    const found = await lookAt((await registered()) ?? [], paths, look, root, option(args, "out"));
    for (const problem of found) process.stdout.write(`${problem.severity === "fail" ? "FAIL" : "warn"} ${problem.path} (${problem.view}): ${problem.message}\n`);
    const failed = found.filter((problem) => problem.severity === "fail").length;
    process.stdout.write(`looked at ${paths.length} page${paths.length === 1 ? "" : "s"} on phone and desktop, light and dark: ${failed ? `${failed} problem${failed === 1 ? "" : "s"} to fix` : "no problems"}${found.length > failed ? `, ${found.length - failed} to consider` : ""}\n`);
    return failed ? 1 : 0;
  } finally {
    await closeBrowser();
  }
}

async function ref(args: readonly string[]): Promise<number> {
  const source = args[1];
  if (!source || source.startsWith("--")) {
    process.stderr.write("usage: app ref <https://site | image address | image file | uploads/name> [--out dir]\n");
    return 2;
  }
  try {
    process.stdout.write(`${summary(await referenceOf(uploadAddress(source), option(args, "out")))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`could not read ${source}: ${(error as Error).message.split("\n")[0]}\n`);
    return 1;
  } finally {
    await closeBrowser();
  }
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
  if (command === "build") return build();
  if (command === "look") return look(args);
  if (command === "ref") return ref(args);
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
  process.stderr.write("usage: app gen [--check] | app build | app look [/path ...] [--features a,b] [--out dir] | app ref <site | image | uploads/name> [--out dir] | app drive <feature> [--url URL] | app proof <feature> --url URL [--commit SHA] [--out FILE]\n");
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
