import { parse as parseYaml } from "yaml";
import type { FileChanges, Tree } from "../git/tree.ts";
import { projectRules, rulePath } from "../checks/project-rules.ts";
import { MEMORY_DIR } from "../memory/memory.ts";
import type { MemoryKind } from "../ports/memory-index.ts";

export const GOAL_FILE = "GOAL.md";
export const AGENTS_FILE = "AGENTS.md";
export const CLAUDE_FILE = "CLAUDE.md";
export const MAX_INSTRUCTIONS_CHARS = 20_000;
export const MAX_MEMORY_CHARS = 50_000;

export interface ProjectGuidance {
  readonly goal: string;
  readonly instructions: string;
}

export function projectGuidance(tree: Tree): ProjectGuidance {
  return { goal: (tree[GOAL_FILE] ?? "").trim(), instructions: (tree[AGENTS_FILE] ?? "").trim() };
}

export function repositoryNotes(tree: Tree): string {
  const text = (tree[CLAUDE_FILE] ?? "").trim();
  const agents = (tree[AGENTS_FILE] ?? "").trim();
  if (!text || text === agents || /^@?\.?\/?AGENTS\.md$/.test(text)) return "";
  return text.length > MAX_INSTRUCTIONS_CHARS ? `${text.slice(0, MAX_INSTRUCTIONS_CHARS)}\n(cut off: the rest of ${CLAUDE_FILE} did not fit)` : text;
}

export function renderGuidance(shared: string, project: ProjectGuidance, repository = ""): string {
  const parts = [
    shared.trim() ? `## Instructions for every project\n\n${shared.trim()}` : null,
    project.goal ? `## This project's goal (${GOAL_FILE})\n\n${project.goal}` : null,
    project.instructions ? `## This project's instructions (${AGENTS_FILE})\n\n${project.instructions}` : null,
    repository ? `## The repository's notes for coding agents (${CLAUDE_FILE})\n\nThe repository came with these notes. Follow them where the instructions above do not say otherwise.\n\n${repository}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "";
  const order = shared.trim() && project.instructions ? "\n\nWhere this project's instructions and the instructions for every project disagree, follow this project's." : "";
  return `# How the person wants this project built\n\nFollow these together with your role's own instructions.${order}\n\n${parts.join("\n\n")}`;
}

export function withGuidance(instructions: string, guidance: string | undefined): string {
  return guidance ? `${instructions}\n\n${guidance}` : instructions;
}

export interface MemoryEntry {
  readonly path: string;
  readonly kind: MemoryKind;
  readonly feature: string | null;
  readonly title: string;
  readonly text: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const KINDS: readonly MemoryKind[] = ["lesson", "feature", "note"];

function split(content: string): { meta: string | null; body: string } {
  const match = FRONTMATTER.exec(content.replace(/\r\n/g, "\n"));
  return match ? { meta: match[1] ?? "", body: (match[2] ?? "").trim() } : { meta: null, body: content.trim() };
}

function metaOf(meta: string | null): { kind?: unknown; feature?: unknown } {
  if (meta === null) return {};
  try {
    return (parseYaml(meta) ?? {}) as { kind?: unknown; feature?: unknown };
  } catch {
    return {};
  }
}

export function isMemoryPath(path: string): boolean {
  return path.startsWith(MEMORY_DIR) && path.endsWith(".md") && !path.includes("..") && /^[A-Za-z0-9._/-]+$/.test(path);
}

export function memoryEntries(tree: Tree): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const [path, content] of Object.entries(tree)) {
    if (!isMemoryPath(path)) continue;
    const { meta, body } = split(content);
    const parsed = metaOf(meta);
    const kind = KINDS.includes(parsed.kind as MemoryKind) ? (parsed.kind as MemoryKind) : "note";
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const title = heading || (path.split("/").at(-1) ?? path).replace(/\.md$/, "");
    entries.push({ path, kind, feature: typeof parsed.feature === "string" ? parsed.feature : null, title, text: body });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export interface LearnedRule {
  readonly id: string;
  readonly path: string;
  readonly message: string;
  readonly files: string;
}

export function learnedRules(tree: Tree): LearnedRule[] {
  return projectRules(tree).map((rule) => ({ id: rule.id, path: rulePath(rule.id), message: rule.message, files: rule.files }));
}

export function memoryText(tree: Tree, path: string): string | null {
  const content = tree[path];
  return content === undefined ? null : split(content).body;
}

export function slugOf(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "note"
  );
}

export function notePath(tree: Tree, title: string): string {
  const base = `${MEMORY_DIR}notes/${slugOf(title)}`;
  let path = `${base}.md`;
  for (let n = 2; tree[path] !== undefined; n++) path = `${base}-${n}.md`;
  return path;
}

export function renderMemoryNote(title: string, text: string): string {
  const body = text.trim();
  const heading = /^#\s+/m.test(body) ? body : `# ${title.trim()}\n\n${body}`;
  return `---\nkind: note\n---\n\n${heading.trim()}\n`;
}

export function rewriteMemory(previous: string, text: string): string {
  const { meta } = split(previous);
  return meta === null ? `${text.trim()}\n` : `---\n${meta}\n---\n\n${text.trim()}\n`;
}

export type GuidanceEdit =
  | { readonly kind: "instructions"; readonly goal: string; readonly instructions: string; readonly previous: ProjectGuidance }
  | { readonly kind: "memory"; readonly path: string; readonly text: string | null; readonly previous: string }
  | { readonly kind: "note"; readonly title: string; readonly text: string };

export type EditResult = { readonly ok: true; readonly changes: FileChanges; readonly message: string; readonly path?: string } | { readonly ok: false; readonly error: string; readonly status: 400 | 404 | 409 };

const CHANGED = "it was changed meanwhile, so reload and make your change again";

export function applyGuidanceEdit(tree: Tree, edit: GuidanceEdit): EditResult {
  if (edit.kind === "instructions") {
    const goal = edit.goal.trim();
    const instructions = edit.instructions.trim();
    if (goal.length > MAX_INSTRUCTIONS_CHARS || instructions.length > MAX_INSTRUCTIONS_CHARS) return { ok: false, status: 400, error: `keep each one under ${MAX_INSTRUCTIONS_CHARS} characters` };
    const current = projectGuidance(tree);
    if (current.goal !== edit.previous.goal.trim() || current.instructions !== edit.previous.instructions.trim()) return { ok: false, status: 409, error: `the goal or instructions: ${CHANGED}` };
    const changes: Record<string, string | null> = {};
    if (goal !== current.goal) changes[GOAL_FILE] = goal ? `${goal}\n` : null;
    if (instructions !== current.instructions) changes[AGENTS_FILE] = instructions ? `${instructions}\n` : null;
    const named = Object.keys(changes);
    return { ok: true, changes, message: named.length ? `docs: update ${named.join(" and ")}` : "" };
  }
  if (edit.kind === "note") {
    const title = edit.title.trim();
    if (!title) return { ok: false, status: 400, error: "give the note a title" };
    if (!edit.text.trim()) return { ok: false, status: 400, error: "the note needs some text" };
    if (edit.text.length > MAX_MEMORY_CHARS) return { ok: false, status: 400, error: `keep a note under ${MAX_MEMORY_CHARS} characters` };
    const path = notePath(tree, title);
    return { ok: true, changes: { [path]: renderMemoryNote(title, edit.text) }, message: `memory: add ${path}`, path };
  }
  if (!isMemoryPath(edit.path)) return { ok: false, status: 400, error: "that is not a memory file" };
  const content = tree[edit.path];
  if (content === undefined) return { ok: false, status: 404, error: `${edit.path} is no longer in the project memory` };
  if (split(content).body !== edit.previous.trim()) return { ok: false, status: 409, error: `${edit.path}: ${CHANGED}` };
  if (edit.text === null) return { ok: true, changes: { [edit.path]: null }, message: `memory: remove ${edit.path}`, path: edit.path };
  if (!edit.text.trim()) return { ok: false, status: 400, error: "the text is empty; remove the entry instead" };
  if (edit.text.length > MAX_MEMORY_CHARS) return { ok: false, status: 400, error: `keep a memory entry under ${MAX_MEMORY_CHARS} characters` };
  return { ok: true, changes: { [edit.path]: rewriteMemory(content, edit.text) }, message: `memory: edit ${edit.path}`, path: edit.path };
}
