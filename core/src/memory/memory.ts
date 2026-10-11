import { parse as parseYaml } from "yaml";
import type { Tree } from "../git/tree.ts";
import type { MemoryDoc, MemoryHit, MemoryKind } from "../ports/memory-index.ts";
import { readSpec } from "../spec/lint.ts";
import type { FeatureSpec } from "../spec/schema.ts";

export const MEMORY_DIR = "memory/";

const KINDS: readonly MemoryKind[] = ["lesson", "feature", "spec", "note"];

export function memoryDocs(tree: Tree): MemoryDoc[] {
  const docs: MemoryDoc[] = [];
  for (const [path, content] of Object.entries(tree)) {
    if (!path.startsWith(MEMORY_DIR) || !path.endsWith(".md")) continue;
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content.replace(/\r\n/g, "\n"));
    let meta: { kind?: unknown; feature?: unknown } = {};
    try {
      meta = (match ? parseYaml(match[1] ?? "") : {}) as typeof meta;
    } catch {
      meta = {};
    }
    const kind = KINDS.includes(meta.kind as MemoryKind) ? (meta.kind as MemoryKind) : "note";
    docs.push({ path, kind, feature: typeof meta.feature === "string" ? meta.feature : null, text: (match?.[2] ?? content).trim() });
  }
  for (const feature of readSpec(tree)) {
    docs.push({ path: `spec/features/${feature.id}.md`, kind: "spec", feature: feature.id, text: specText(feature) });
  }
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}

function specText(feature: FeatureSpec): string {
  return [`# ${feature.title} (${feature.id})`, `Status: ${feature.status}. Entrypoint: ${feature.entrypoint}.`, ...feature.acceptance.map((c) => `- ${c.id}: ${c.text}`), "", feature.body].join("\n").trim();
}

export function lessonPath(featureId: string, mergedCommit: string): string {
  return `${MEMORY_DIR}lessons/${featureId}-${mergedCommit.slice(0, 12)}.md`;
}

export function renderLesson(input: { feature: FeatureSpec | undefined; featureId: string; mergedCommit: string; log: string; prompts: readonly string[] }): string {
  const criteria = input.feature?.acceptance.map((c) => `- ${c.id}: ${c.text}`) ?? [];
  const failing = input.log.trim().split("\n").slice(-40).join("\n");
  return [
    "---",
    "kind: lesson",
    `feature: ${input.featureId}`,
    `source: revert of ${input.mergedCommit.slice(0, 12)}`,
    "---",
    "",
    `# ${input.featureId}: a merge was reverted`,
    "",
    "The change passed every gate check, but main went red after it merged, so the merge was reverted.",
    "",
    "## What failed on main",
    "",
    "```",
    failing,
    "```",
    "",
    ...(criteria.length ? ["## Acceptance criteria at the time", "", ...criteria, ""] : []),
    ...(input.prompts.length ? ["## Prompts that produced it", "", ...input.prompts.map((p) => `- ${firstLine(p)}`), ""] : []),
    "## Next time",
    "",
    "Write a test for each failing case above, named after the acceptance criterion it belongs to, before changing the code. Check the edge cases each criterion implies, not only the example in its text.",
    "",
  ].join("\n");
}

export interface SessionSummary {
  readonly feature: FeatureSpec;
  readonly sessionId: string;
  readonly parent: string | null;
  readonly rootPrompt: string;
  readonly attempt: { readonly index: number; readonly of: number };
  readonly turns: readonly { readonly role: string; readonly message: string }[];
  readonly feedback: readonly string[];
}

export function featureMemoryPath(featureId: string): string {
  return `${MEMORY_DIR}features/${featureId}.md`;
}

export function renderFeatureMemory(previous: string | undefined, summary: SessionSummary): string {
  const earlier = previous ? (/^## Sessions\n([\s\S]*)$/m.exec(previous)?.[1] ?? "").trim() : "";
  const lines = [
    `### ${summary.sessionId}${summary.parent ? ` (follows ${summary.parent})` : ""}`,
    "",
    `Prompt: ${firstLine(summary.rootPrompt)}`,
    ...(summary.attempt.of > 1 ? [`Attempt ${summary.attempt.index} of ${summary.attempt.of}, picked by the reviewer.`] : []),
    "",
    ...summary.turns.map((t) => `- ${t.role}: ${firstLine(t.message)}`),
    ...(summary.feedback.length ? ["", "Corrections:", ...summary.feedback.map((f) => `- ${firstLine(f)}`)] : []),
  ];
  return [
    "---",
    "kind: feature",
    `feature: ${summary.feature.id}`,
    "---",
    "",
    `# ${summary.feature.title} (${summary.feature.id})`,
    "",
    `Spec revision ${summary.feature.revision}, entrypoint ${summary.feature.entrypoint}.`,
    "",
    ...summary.feature.acceptance.map((c) => `- ${c.id}: ${c.text}`),
    "",
    "## Sessions",
    "",
    ...(earlier ? [earlier, ""] : []),
    ...lines,
    "",
  ].join("\n");
}

export function renderRecall(hits: readonly MemoryHit[]): string {
  if (hits.length === 0) return "";
  const parts = hits.map((h) => `### ${h.doc.path}\n${h.doc.text.slice(0, 1500)}`);
  return `Project memory that may apply (most relevant first):\n\n${parts.join("\n\n")}`;
}

function firstLine(text: string): string {
  return (text.trim().split("\n")[0] ?? "").slice(0, 160);
}
