import type { KargahEvent } from "../events/events.ts";
import { diffTrees, type FileChanges } from "../git/tree.ts";
import { NOTES_NAMESPACE, parseNote, type TurnNote } from "../notes/notes.ts";
import type { RepoHost } from "../ports/repo-host.ts";
import type { SessionRecord } from "../session/record.ts";
import { readSpec } from "../spec/lint.ts";
import { reviewMessages, reviewTarget, type ChatMessage, type ReviewOutcome } from "./review-prompt.ts";

export interface ReviewPoint {
  readonly sessionId: string;
  readonly featureId: string;
  readonly head: string;
  readonly base: string;
  readonly outcome: ReviewOutcome;
  readonly logIndex: number;
}

export interface ReviewExample {
  readonly id: string;
  readonly featureId: string;
  readonly sessionId: string;
  readonly outcome: ReviewOutcome;
  readonly label: "approve" | "reject";
  readonly messages: readonly ChatMessage[];
}

export interface TurnExample {
  readonly id: string;
  readonly featureId: string;
  readonly sessionId: string;
  readonly commitId: string;
  readonly role: string;
  readonly kind: TurnNote["kind"];
  readonly outcome: ReviewOutcome;
  readonly label: "positive" | "negative";
  readonly prompt: string;
  readonly changes: FileChanges;
}

const CODER_KINDS: ReadonlySet<TurnNote["kind"]> = new Set(["test", "code", "fix", "refactor", "conflict"]);

export function reviewPoints(log: readonly KargahEvent[]): ReviewPoint[] {
  const reverted = new Set(log.flatMap((e) => (e.type === "main.reverted" ? [e.revertedCommit] : [])));
  const points: ReviewPoint[] = [];
  log.forEach((event, index) => {
    if (event.type !== "review.verdict" || !event.approve) return;
    const after = log.slice(index + 1);
    const gate = after.find((e) => e.type === "gate.result" && e.sessionId === event.sessionId);
    if (gate?.type !== "gate.result") return;
    let outcome: ReviewOutcome = "gate-failed";
    if (gate.ok) {
      const merged = after.find((e) => e.type === "main.merged" && e.sessionId === event.sessionId);
      if (merged?.type !== "main.merged") return;
      outcome = reverted.has(merged.commitId) ? "reverted" : "merged";
    }
    points.push({ sessionId: event.sessionId, featureId: event.featureId, head: event.head, base: event.base, outcome, logIndex: index });
  });
  return points;
}

export async function exportOutcomes(input: { readonly log: readonly KargahEvent[]; readonly repos: Pick<RepoHost, "readCommit" | "readNote">; readonly canonical: string; readonly sessions: readonly SessionRecord[] }): Promise<{ reviews: ReviewExample[]; turns: TurnExample[] }> {
  const forks = new Map(input.sessions.map((s) => [s.id, s.fork]));
  const points = reviewPoints(input.log);
  const reviews: ReviewExample[] = [];
  for (const point of points) {
    const fork = forks.get(point.sessionId);
    if (!fork) continue;
    const head = await input.repos.readCommit(fork, point.head);
    const base = await input.repos.readCommit(input.canonical, point.base);
    if (!head || !base) continue;
    const feature = readSpec(head.tree).find((f) => f.id === point.featureId) ?? input.sessions.find((s) => s.id === point.sessionId)?.plan.feature;
    if (!feature) continue;
    const messages = [...reviewMessages({ feature, diff: diffTrees(base.tree, head.tree) }), { role: "assistant" as const, content: reviewTarget(point.outcome) }];
    reviews.push({ id: `${point.sessionId}-${point.head.slice(0, 12)}`, featureId: point.featureId, sessionId: point.sessionId, outcome: point.outcome, label: point.outcome === "merged" ? "approve" : "reject", messages });
  }
  const turns: TurnExample[] = [];
  for (const [index, event] of input.log.entries()) {
    if (event.type !== "commit.created") continue;
    const point = points.find((p) => p.sessionId === event.sessionId && p.logIndex > index);
    if (!point) continue;
    const note = parseNote(await input.repos.readNote(event.repo, NOTES_NAMESPACE, event.commitId));
    if (!note || !CODER_KINDS.has(note.kind)) continue;
    const commit = await input.repos.readCommit(event.repo, event.commitId);
    const parent = commit?.parents[0] ? await input.repos.readCommit(event.repo, commit.parents[0]) : null;
    if (!commit) continue;
    turns.push({
      id: event.commitId.slice(0, 12),
      featureId: event.featureId,
      sessionId: event.sessionId,
      commitId: event.commitId,
      role: note.role,
      kind: note.kind,
      outcome: point.outcome,
      label: point.outcome === "merged" ? "positive" : "negative",
      prompt: note.prompt,
      changes: diffTrees(parent?.tree ?? {}, commit.tree),
    });
  }
  return { reviews, turns };
}

export function toJsonl(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}
