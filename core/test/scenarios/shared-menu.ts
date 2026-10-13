import type { Tree } from "../../src/git/tree.ts";
import type { Script } from "../../src/fakes/index.ts";
import type { FeatureSpec } from "../../src/spec/schema.ts";

export const MENU_PATH = "shared/menu.ts";

export const MENU = ["export const menu: readonly string[] = [", '  "home",', "];", ""].join("\n");

export const FEATURES = ["notes", "tags", "search"] as const;

export function promptFor(id: string): string {
  return `Add a ${id} page linked from the menu`;
}

export function specFor(id: string): FeatureSpec {
  return {
    id,
    title: `${id.charAt(0).toUpperCase()}${id.slice(1)} page`,
    status: "building",
    entrypoint: `GET /${id}`,
    revision: 1,
    shared: [MENU_PATH],
    env: [],
    acceptance: [
      { id: "AC1", text: `GET /${id} answers with the page name` },
      { id: "AC2", text: `the menu links to ${id}` },
    ],
    body: `A user opens the ${id} page from the menu.`,
  };
}

export function presets(): Map<string, FeatureSpec> {
  return new Map(FEATURES.map((id) => [promptFor(id), specFor(id)]));
}

function implementation(id: string): string {
  return [
    'import { json, type Feature } from "../../shared/http.ts";',
    'import { menu } from "../../shared/menu.ts";',
    "",
    "export const feature: Feature = {",
    `  id: "${id}",`,
    `  title: "${specFor(id).title}",`,
    `  routes: [{ method: "GET", path: "/${id}", handle: async () => json({ page: "${id}", menu }) }],`,
    "};",
    "",
  ].join("\n");
}

function tests(id: string): string {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { createApp } from "../../shared/http.ts";',
    'import { menu } from "../../shared/menu.ts";',
    'import { MemoryStore } from "../../shared/storage.ts";',
    'import { feature } from "./index.ts";',
    "",
    `test("AC1: GET /${id} answers with the page name", async () => {`,
    "  const app = createApp([feature], new MemoryStore());",
    `  const response = await app(new Request("http://app.test/${id}"));`,
    "  assert.equal(response.status, 200);",
    `  assert.equal(((await response.json()) as { page: string }).page, "${id}");`,
    "});",
    "",
    `test("AC2: the menu links to ${id}", () => {`,
    `  assert.ok(menu.includes("${id}"));`,
    "});",
    "",
  ].join("\n");
}

function flow(id: string): string {
  return [
    'import type { Flow } from "../../shared/flow.ts";',
    "",
    "export const flow: Flow = {",
    `  feature: "${id}",`,
    "  steps: [",
    "    {",
    `      name: "AC1: open the ${id} page",`,
    `      request: { method: "GET", path: "/${id}" },`,
    `      expect: ({ status, body }) => (status === 200 && (body as { page?: string }).page === "${id}" ? null : \`expected the ${id} page, got \${status}\`),`,
    "    },",
    "    {",
    `      name: "AC2: the menu links to ${id}",`,
    `      request: { method: "GET", path: "/${id}" },`,
    `      expect: ({ body }) => ((body as { menu?: string[] }).menu?.includes("${id}") ? null : "menu does not link to ${id}"),`,
    "    },",
    "  ],",
    "};",
    "",
  ].join("\n");
}

export function addToMenu(menu: string, id: string): string {
  const lines = menu.split("\n");
  if (lines.includes(`  "${id}",`)) return menu;
  const close = lines.indexOf("];");
  lines.splice(close, 0, `  "${id}",`);
  return lines.join("\n");
}

export function resolveUnion(text: string): string {
  const out: string[] = [];
  let mine: string[] | null = null;
  let theirs: string[] | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("<<<<<<< ")) mine = [];
    else if (line === "=======" && mine) theirs = [];
    else if (line.startsWith(">>>>>>> ") && mine && theirs) {
      out.push(...theirs, ...mine.filter((l) => !theirs?.includes(l)));
      mine = theirs = null;
    } else if (theirs) theirs.push(line);
    else if (mine) mine.push(line);
    else out.push(line);
  }
  return out.join("\n");
}

export function bootstrapTree(template: Tree): Tree {
  return { ...template, [MENU_PATH]: MENU };
}

export const script: Script = (input) => {
  const id = input.featureId;
  const tree = input.workspace.tree;
  if (input.role === "test") return { changes: { [`features/${id}/${id}.test.ts`]: tests(id), [`features/${id}/flow.ts`]: flow(id) } };
  if (input.role === "conflict-resolver") {
    const changes: Record<string, string> = {};
    for (const [path, content] of Object.entries(tree)) if (content.includes("<<<<<<< ")) changes[path] = resolveUnion(content);
    return { changes, summary: `resolve conflicts in ${Object.keys(changes).join(", ")}` };
  }
  return { changes: { [`features/${id}/index.ts`]: implementation(id), [MENU_PATH]: addToMenu(tree[MENU_PATH] ?? MENU, id) } };
};
