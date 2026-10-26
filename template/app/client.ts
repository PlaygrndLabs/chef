import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fontAssets, type FontAssets } from "./fonts.ts";
import { lookOf, staticPages, type LookInfo, type PageInfo, type PageMeta } from "../shared/meta.ts";

const own = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const CLIENT_FILES = ["pages.tsx", "look.ts"] as const;

export function clientParts(paths: Iterable<string>): { readonly pages: string[]; readonly looks: string[] } {
  const pages: string[] = [];
  const looks: string[] = [];
  for (const path of paths) {
    const match = /^features\/[a-z][a-z0-9-]*\/(?:[a-z][a-z0-9-]*\/)?(pages\.tsx|look\.ts)$/.exec(path);
    if (match?.[1] === "pages.tsx") pages.push(path);
    else if (match?.[1] === "look.ts") looks.push(path);
  }
  return { pages: pages.sort(), looks: looks.sort() };
}

function parts(paths: Iterable<string>, owned = false): { readonly imports: string[]; readonly pages: string; readonly looks: string } {
  const { pages, looks } = clientParts(paths);
  return {
    imports: [...pages.map((path, i) => `import { pages as pages${i} } from "./${path}";`), ...looks.map((path, i) => `import { look as look${i} } from "./${path}";`)],
    pages: `[${pages.map((path, i) => (owned ? `...pages${i}.map((page) => ({ ...page, feature: ${JSON.stringify(path.split("/")[1])} }))` : `...pages${i}`)).join(", ")}]`,
    looks: `[${looks.map((_, i) => `look${i}`).join(", ")}]`,
  };
}

export function renderClient(paths: Iterable<string>): string {
  const { imports, pages, looks } = parts(paths);
  return [`import { start } from "./shared/app.tsx";`, ...imports, "", `start(${pages}, ${looks});`, ""].join("\n");
}

export function renderPageList(paths: Iterable<string>): string {
  const { imports, pages, looks } = parts(paths, true);
  return [...imports, "", `export const pages = ${pages};`, `export const looks = ${looks};`, ""].join("\n");
}

export async function clientPaths(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory() && depth < 2) await walk(path, depth + 1);
      else if (entry.isFile() && (CLIENT_FILES as readonly string[]).includes(entry.name)) found.push(path);
    }
  };
  await walk("features", 0);
  return found;
}

export async function bundleClient(root: string, options: { readonly minify?: boolean } = {}): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    stdin: { contents: renderClient(await clientPaths(root)), resolveDir: resolve(root), sourcefile: "client.tsx", loader: "tsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: options.minify ?? true,
    legalComments: "none",
    logLevel: "silent",
    nodePaths: [join(own, "node_modules")],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  return result.outputFiles[0]?.text ?? "";
}

export type OwnedPage = PageInfo & { readonly feature: string };

export async function listed(root: string): Promise<{ readonly pages: OwnedPage[]; readonly look: LookInfo }> {
  const { build } = await import("esbuild");
  const result = await build({
    stdin: { contents: renderPageList(await clientPaths(root)), resolveDir: resolve(root), sourcefile: "pages.tsx", loader: "tsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    jsx: "automatic",
    legalComments: "none",
    logLevel: "silent",
    nodePaths: [join(own, "node_modules")],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  const code = result.outputFiles[0]?.text ?? "";
  const found = (await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)) as { pages: OwnedPage[]; looks: LookInfo[] };
  return { pages: found.pages, look: lookOf(found.looks) };
}

export async function pageMetas(root: string, served: readonly string[] = []): Promise<Map<string, PageMeta>> {
  const { pages, look } = await listed(root);
  return staticPages(pages, look, served);
}

export async function appFonts(root: string): Promise<FontAssets> {
  return fontAssets((await listed(root)).look.fonts, join(own, "node_modules"));
}
