import { z } from "zod";
import { COMPOSE_SUGGESTION, hasComposeFile, MAP_SUGGESTION, wasMapped } from "@chef/core";
import { DEFAULT_MODEL, structured, type LlmEndpoint } from "./anthropic.ts";

export const OverviewSchema = z.object({
  summary: z.string(),
  problems: z.array(z.string()),
  suggestions: z.array(z.object({ title: z.string(), why: z.string(), prompt: z.string() })),
});

export type Overview = z.infer<typeof OverviewSchema>;

export type OverviewState =
  | { readonly status: "none" }
  | { readonly status: "reading"; readonly since: number }
  | { readonly status: "ready"; readonly commitId: string | null; readonly at: number; readonly overview: Overview }
  | { readonly status: "failed"; readonly at: number; readonly error: string };

const MAX_PATHS = 600;
const MAX_FILE = 12_000;
const MAX_TOTAL = 90_000;
const SKIP = /(^|\/)(node_modules|dist|build|\.git|\.wrangler|vendor|coverage)\//;

function rank(path: string): number {
  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  const depth = lower.split("/").length;
  if (depth === 1 && name.startsWith("readme")) return 0;
  if (depth === 1 && /^(goal|vision|todo|roadmap|tasks|plan|claude|agents)\b.*\.(md|txt)$/.test(name)) return 1;
  if (depth === 1 && name === "package.json") return 2;
  if (lower.startsWith("spec/") && name.endsWith(".md")) return 3;
  if (/(^|\/)(todo|roadmap|tasks|issues)\b[^/]*\.(md|txt)$/.test(lower)) return 4;
  if (lower.startsWith("docs/") && name.endsWith(".md") && depth <= 2) return 5;
  if (depth === 1 && /^(pyproject\.toml|cargo\.toml|go\.mod|wrangler\.(toml|json|jsonc)|dockerfile)$/.test(name)) return 6;
  if (depth === 2 && name.startsWith("readme")) return 7;
  if (depth === 1 && name.startsWith("changelog")) return 8;
  return -1;
}

export function digest(tree: Readonly<Record<string, string>>): { readonly paths: readonly string[]; readonly files: readonly { readonly path: string; readonly text: string }[] } {
  const paths = Object.keys(tree)
    .filter((p) => !SKIP.test(p))
    .sort();
  const picked = paths
    .map((path) => ({ path, rank: rank(path) }))
    .filter((p) => p.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
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

const SYSTEM = `You are Chef, an agent that builds software features on its own. Someone just brought an existing project into Chef, and you are reading it for the first time, the way a new teammate would.
Write for the project's owner in plain words. No jargon they did not use, no file paths unless they help.`;

export function withChefSuggestions(overview: Overview, tree: Readonly<Record<string, string>>): Overview {
  return { ...overview, suggestions: [...(wasMapped(tree) ? [] : [{ ...MAP_SUGGESTION }]), ...(hasComposeFile(tree) ? [] : [{ ...COMPOSE_SUGGESTION }])] };
}

const ReadingSchema = OverviewSchema.omit({ suggestions: true });

export async function exploreProject(llm: LlmEndpoint, input: { readonly name: string; readonly tree: Readonly<Record<string, string>>; readonly model?: string; readonly imported?: boolean }): Promise<Overview> {
  const { paths, files } = digest(input.tree);
  const prompt = [
    `Project: ${input.name}`,
    `Files (${paths.length}${Object.keys(input.tree).length > paths.length ? ` of ${Object.keys(input.tree).length}` : ""}):\n${paths.join("\n")}`,
    ...files.map((f) => `### ${f.path}\n${f.text}`),
    [
      "Write:",
      "- summary: two or three sentences on what this project is, who uses it, and how.",
      "- problems: up to four open problems or gaps you can see evidence for (a task list, TODOs, missing tests, half-built parts). Each one sentence. Leave it empty rather than guess.",
    ].join("\n"),
  ].join("\n\n");
  const result = await structured(llm, { model: input.model ?? DEFAULT_MODEL, system: SYSTEM, effort: "medium", schema: ReadingSchema, prompt });
  return { summary: result.summary.trim(), problems: result.problems.slice(0, 4), suggestions: [] };
}
