import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { FileChanges, Tree } from "../git/tree.ts";
import { FEATURE_ID, type FeatureSpec } from "../spec/schema.ts";

export const FEATURES_DIR = ".chef/features";
export const START_FILE = `${FEATURES_DIR}/PATH.md`;
export const SPECS_FILE = "SPECS.md";
export const PATH_FILE = "PATH.md";

export const MAP_STATES = ["current", "wish"] as const;

export type MapState = (typeof MAP_STATES)[number];

export const MapFrontmatter = z.object({
  title: z.string().trim().min(1).max(120),
  state: z.enum(MAP_STATES).default("current"),
});

export interface MapFeature {
  readonly id: string;
  readonly name: string;
  readonly parent: string | null;
  readonly title: string;
  readonly state: MapState;
  readonly specs: string;
  readonly path: string;
}

export interface FeatureMap {
  readonly start: string;
  readonly features: readonly MapFeature[];
}

export interface MapEntry {
  readonly id: string;
  readonly title: string;
  readonly state?: MapState;
  readonly specs?: string;
  readonly path?: string;
}

export function featureDir(id: string): string {
  return `${FEATURES_DIR}/${id}`;
}

export function nameOf(id: string): string {
  return id.split("/").at(-1) ?? id;
}

export function parentOf(id: string): string | null {
  const at = id.lastIndexOf("/");
  return at < 0 ? null : id.slice(0, at);
}

export function isFeaturePath(id: string): boolean {
  return id.length > 0 && id.length <= 400 && id.split("/").every((part) => FEATURE_ID.test(part) && part.length <= 40);
}

export function featureSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[0-9-]+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "feature";
}

function split(source: string): { data: unknown; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (!match) return { data: null, body: source.trim() };
  try {
    return { data: parseYaml(match[1] ?? ""), body: (match[2] ?? "").trim() };
  } catch {
    return { data: null, body: (match[2] ?? "").trim() };
  }
}

function titleFrom(name: string): string {
  const words = name.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function readFeatureMap(tree: Tree): FeatureMap {
  const prefix = `${FEATURES_DIR}/`;
  const ids = new Set<string>();
  for (const file of Object.keys(tree)) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const at = rest.lastIndexOf("/");
    if (at < 0) continue;
    const base = rest.slice(at + 1);
    if (base !== SPECS_FILE && base !== PATH_FILE) continue;
    const id = rest.slice(0, at);
    if (!isFeaturePath(id)) continue;
    for (let parent = parentOf(id); parent; parent = parentOf(parent)) ids.add(parent);
    ids.add(id);
  }
  const features = [...ids].sort(byPath).map((id): MapFeature => {
    const specs = tree[`${featureDir(id)}/${SPECS_FILE}`];
    const { data, body } = specs === undefined ? { data: null, body: "" } : split(specs);
    const parsed = MapFrontmatter.safeParse(data ?? {});
    const name = nameOf(id);
    return {
      id,
      name,
      parent: parentOf(id),
      title: parsed.success ? parsed.data.title : typeof (data as { title?: unknown } | null)?.title === "string" && (data as { title: string }).title.trim() ? (data as { title: string }).title.trim().slice(0, 120) : titleFrom(name),
      state: parsed.success ? parsed.data.state : (data as { state?: unknown } | null)?.state === "wish" ? "wish" : "current",
      specs: body,
      path: (tree[`${featureDir(id)}/${PATH_FILE}`] ?? "").trim(),
    };
  });
  return { start: (tree[START_FILE] ?? "").trim(), features };
}

function byPath(a: string, b: string): number {
  const x = a.split("/");
  const y = b.split("/");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const order = (x[i] as string).localeCompare(y[i] as string);
    if (order !== 0) return order;
  }
  return x.length - y.length;
}

export function wasMapped(tree: Tree): boolean {
  return START_FILE in tree;
}

export function renderSpecs(entry: Pick<MapEntry, "title" | "state" | "specs">): string {
  const head = stringifyYaml({ title: entry.title.trim(), state: entry.state ?? "current" }).trimEnd();
  const body = (entry.specs ?? "").trim();
  return `---\n${head}\n---\n${body ? `\n${body}\n` : ""}`;
}

export function renderPath(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n` : "";
}

export function entryChanges(entry: MapEntry): FileChanges {
  const dir = featureDir(entry.id);
  return { [`${dir}/${SPECS_FILE}`]: renderSpecs(entry), [`${dir}/${PATH_FILE}`]: renderPath(entry.path ?? "") };
}

export function mapChanges(input: { readonly start?: string; readonly entries: readonly MapEntry[] }): FileChanges {
  const changes: Record<string, string | null> = {};
  if (input.start !== undefined) changes[START_FILE] = renderPath(input.start);
  for (const entry of input.entries) Object.assign(changes, entryChanges(entry));
  return changes;
}

export function filesUnder(tree: Tree, id: string): string[] {
  const dir = `${featureDir(id)}/`;
  return Object.keys(tree).filter((file) => file.startsWith(dir));
}

export function removeChanges(tree: Tree, id: string): FileChanges {
  return Object.fromEntries(filesUnder(tree, id).map((file) => [file, null]));
}

export function moveChanges(tree: Tree, id: string, to: string): FileChanges {
  const from = `${featureDir(id)}/`;
  const target = `${featureDir(to)}/`;
  const changes: Record<string, string | null> = {};
  for (const file of filesUnder(tree, id)) {
    changes[file] = null;
    changes[`${target}${file.slice(from.length)}`] = tree[file] as string;
  }
  return changes;
}

export function subtreeIds(map: FeatureMap, id: string): string[] {
  return map.features.filter((f) => f.id === id || f.id.startsWith(`${id}/`)).map((f) => f.id);
}

export function findByName(map: FeatureMap, name: string): MapFeature | undefined {
  return map.features.find((f) => f.name === name);
}

export function stepsTo(map: FeatureMap, id: string): { readonly start: string; readonly steps: readonly { readonly id: string; readonly title: string; readonly path: string }[] } {
  const chain: { id: string; title: string; path: string }[] = [];
  for (let at: string | null = id; at; at = parentOf(at)) {
    const feature = map.features.find((f) => f.id === at);
    if (feature) chain.unshift({ id: feature.id, title: feature.title, path: feature.path });
  }
  return { start: map.start, steps: chain };
}

export function freeName(map: FeatureMap, wanted: string, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...map.features.map((f) => f.name), ...taken]);
  const base = featureSlug(wanted);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 40 - String(n).length - 1)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function renderMapOutline(map: FeatureMap, options: { readonly paths?: boolean; readonly limit?: number } = {}): string {
  const lines: string[] = [];
  if (options.paths && map.start) lines.push(`Start: ${oneLine(map.start)}`);
  for (const feature of map.features.slice(0, options.limit ?? 400)) {
    const depth = feature.id.split("/").length - 1;
    const path = options.paths && feature.path ? ` | path: ${oneLine(feature.path)}` : "";
    lines.push(`${"  ".repeat(depth)}- ${feature.name}: ${feature.title} [${feature.state}]${path}`);
  }
  return lines.join("\n");
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " / ").slice(0, 400);
}

export function mapProblems(tree: Tree): string[] {
  const problems: string[] = [];
  const map = readFeatureMap(tree);
  const seen = new Map<string, string>();
  for (const feature of map.features) {
    const other = seen.get(feature.name);
    if (other) problems.push(`${FEATURES_DIR}: ${feature.id} and ${other} share the short name ${feature.name}`);
    else seen.set(feature.name, feature.id);
    const specs = tree[`${featureDir(feature.id)}/${SPECS_FILE}`];
    if (specs === undefined) {
      problems.push(`${featureDir(feature.id)}: missing ${SPECS_FILE} with a title`);
      continue;
    }
    const parsed = MapFrontmatter.safeParse(split(specs).data ?? {});
    if (!parsed.success) problems.push(`${featureDir(feature.id)}/${SPECS_FILE}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "frontmatter"}: ${i.message}`).join("; ")}`);
  }
  return problems;
}

export function mergedEntryChanges(tree: Tree, feature: { readonly id: string; readonly title: string; readonly parent?: string | undefined; readonly entrypoint?: string | undefined }): FileChanges {
  const map = readFeatureMap(tree);
  const existing = findByName(map, feature.id);
  if (existing) return existing.state === "current" ? {} : { [`${featureDir(existing.id)}/${SPECS_FILE}`]: renderSpecs({ title: existing.title, state: "current", specs: existing.specs }) };
  const under = feature.parent ? findByName(map, feature.parent)?.id : undefined;
  const id = under ? `${under}/${feature.id}` : feature.id;
  if (!isFeaturePath(id)) return {};
  const entrypoint = feature.entrypoint?.trim();
  return entryChanges({ id, title: feature.title, state: "current", path: entrypoint ? `Open ${entrypoint}.` : "" });
}

export function mapAsSpec(map: FeatureMap, known: ReadonlySet<string>): FeatureSpec[] {
  const seen = new Set(known);
  const specs: FeatureSpec[] = [];
  for (const feature of map.features) {
    if (seen.has(feature.name)) continue;
    seen.add(feature.name);
    const parent = feature.parent ? nameOf(feature.parent) : null;
    specs.push({
      id: feature.name,
      title: feature.title,
      status: feature.state === "current" ? "merged" : "proposed",
      entrypoint: (feature.path.split("\n").find((line) => line.trim()) ?? feature.title).trim().slice(0, 200),
      ...(parent ? { parent } : {}),
      revision: 1,
      shared: [],
      env: [],
      acceptance: [{ id: "AC1", text: feature.title }],
      body: feature.specs,
    });
  }
  return specs;
}
