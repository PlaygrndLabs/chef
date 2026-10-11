import type { FileChanges } from "../git/tree.ts";
import type { ReviewInput } from "../ports/reviewer.ts";

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export type ReviewOutcome = "merged" | "reverted" | "gate-failed";

const INSTRUCTIONS = "You review one feature's change for kargah before it merges. Approve only when the code does what every acceptance criterion says, including the cases each criterion implies, and the tests would fail on code that gets one of those cases wrong.";

const TARGETS: Readonly<Record<ReviewOutcome, string>> = {
  merged: "approve",
  reverted: "reject: a case the acceptance criteria imply is not handled or not tested",
  "gate-failed": "reject: the implementation does not pass its tests",
};

function featureFiles(diff: FileChanges, featureId: string): string {
  return Object.entries(diff)
    .filter(([path]) => path.startsWith(`features/${featureId}/`) && !path.endsWith("/flow.ts"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => (content === null ? `--- deleted ${path}` : `--- ${path}\n${content.trim()}`))
    .join("\n\n");
}

export function reviewMessages(input: Pick<ReviewInput, "feature" | "diff">, maxChars = 12_000): ChatMessage[] {
  const f = input.feature;
  const spec = [`Feature ${f.id}: ${f.title}`, `Entrypoint: ${f.entrypoint}`, ...f.acceptance.map((c) => `- ${c.id}: ${c.text}`)].join("\n");
  const files = featureFiles(input.diff, f.id).slice(0, maxChars);
  return [{ role: "user", content: `${INSTRUCTIONS}\n\nSpec:\n${spec}\n\nChange:\n${files || "(no feature files)"}\n\nAnswer with one line: approve, or reject: <reason>.` }];
}

export function reviewTarget(outcome: ReviewOutcome): string {
  return TARGETS[outcome];
}

export function parseReviewAnswer(text: string): { approve: boolean; reasons: string[] } {
  const line = text.trim().split("\n")[0]?.trim().toLowerCase() ?? "";
  if (/^\W*approve\b/.test(line)) return { approve: true, reasons: [] };
  const reason = text.trim().split("\n")[0]?.replace(/^\W*reject\W*/i, "").trim();
  return { approve: false, reasons: [reason || "the reviewer did not approve"] };
}

export function gemmaPrompt(messages: readonly ChatMessage[]): string {
  return `${messages.map((m) => `<start_of_turn>${m.role === "user" ? "user" : "model"}\n${m.content}<end_of_turn>\n`).join("")}<start_of_turn>model\n`;
}
