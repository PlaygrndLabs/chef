import { z } from "zod";
import { FEATURES_DIR, type MapInput, type MappedFeatures } from "@chef/core";

export const MappedSchema = z.object({
  start: z.string().describe("How to spin up the project from a fresh checkout until its app is open: the commands to install and run it and the address or screen to open. A few short lines."),
  features: z.array(
    z.object({
      name: z.string().describe("Short name: lowercase kebab-case, at most 40 characters, unique in the list, like sign-in or checkout."),
      title: z.string().describe("A few words a user of the app would call it."),
      parent: z.string().nullable().describe("The name of the feature this one sits under, or null for a top-level feature."),
      path: z.string().describe("Only the steps after the parent's state: what to open, click or type, starting from where the parent feature is visible and usable, until this feature is visible and can be used. A top-level feature starts from the running app."),
    }),
  ),
});

const MAX_PATHS = 1500;
const MAX_FILE = 8_000;
const MAX_TOTAL = 160_000;
const SKIP = /(^|\/)(node_modules|dist|build|out|\.git|\.next|\.nuxt|\.wrangler|\.turbo|vendor|coverage|__snapshots__|fixtures?)\//;
const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|eot|mp[34]|webm|wasm|zip|gz|pdf|lock)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i;
const SOURCE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|py|rb|go|rs|java|kt|swift|php|ex|exs|html?)$/i;

function rank(path: string): number {
  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  const depth = lower.split("/").length;
  if (lower.startsWith(`${FEATURES_DIR}/`)) return -1;
  if (depth === 1 && name.startsWith("readme")) return 0;
  if (depth === 1 && /^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|gemfile|composer\.json|dockerfile|docker-compose\.ya?ml|compose\.ya?ml|makefile|procfile)$/.test(name)) return 1;
  if (depth <= 2 && /^(vite|next|nuxt|astro|svelte|remix|webpack)\.config\.[a-z]+$/.test(name)) return 2;
  if (/(^|\/)(routes?|router|routing|urls|pages|app|views|screens)(\/|\.[a-z]+$)/.test(lower) && SOURCE.test(name)) return 3;
  if (/(^|\/)(main|index|app|server|root|layout)\.[a-z]+$/.test(lower) && SOURCE.test(name) && depth <= 3) return 4;
  if (/(^|\/)(components|features|modules|controllers|handlers|api)\//.test(lower) && SOURCE.test(name)) return 5;
  if (lower.startsWith("docs/") && name.endsWith(".md")) return 6;
  if (lower.startsWith("spec/") && name.endsWith(".md")) return 6;
  if (SOURCE.test(name) && !/\.(test|spec|stories)\./.test(name)) return 7;
  return -1;
}

export function codeDigest(tree: Readonly<Record<string, string>>): { readonly paths: readonly string[]; readonly files: readonly { readonly path: string; readonly text: string }[] } {
  const paths = Object.keys(tree)
    .filter((p) => !SKIP.test(p) && !BINARY.test(p))
    .sort();
  const picked = paths
    .map((path) => ({ path, rank: rank(path) }))
    .filter((p) => p.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  const files: { path: string; text: string }[] = [];
  let total = 0;
  for (const { path } of picked) {
    const text = (tree[path] ?? "").slice(0, MAX_FILE);
    if (!text.trim() || total + text.length > MAX_TOTAL) continue;
    files.push({ path, text });
    total += text.length;
  }
  return { paths: paths.slice(0, MAX_PATHS), files };
}

export function mapPrompt(input: MapInput): string {
  const { paths, files } = codeDigest(input.tree);
  const all = Object.keys(input.tree).length;
  return [
    `Project: ${input.project}`,
    input.map ? `The feature list already has these, so do not repeat them; you may put new ones under them by name:\n${input.map}` : "The feature list is empty.",
    `Files (${paths.length}${all > paths.length ? ` of ${all}` : ""}):\n${paths.join("\n")}`,
    ...files.map((f) => `### ${f.path}\n${f.text}`),
    [
      "Explore this code and list the features the app has today, as its users see them, for the project's feature list.",
      "- Only what the code really has. No wishes, no plans from a roadmap, no internal plumbing a user never meets (build setup, helpers, tests).",
      "- Give every feature a parent when reaching it takes every step of reaching another feature and then more. When two features need each other equally, put the one the others exist for on top.",
      "- path is how to reach the feature from its parent, written as steps a person can follow in the running app. start is how to spin up the whole project.",
      "- Prefer 5 to 40 features for a typical app, fewer for a small one; go two or three levels deep where the app does.",
    ].join("\n"),
  ].join("\n\n");
}

export function cleanMapped(result: z.infer<typeof MappedSchema>): MappedFeatures {
  return {
    start: result.start.trim(),
    features: result.features.map((f) => ({ name: f.name.trim(), title: f.title.trim(), parent: f.parent?.trim() || null, path: f.path.trim() })).filter((f) => f.title),
  };
}
