import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toJsonl, type ReviewExample, type TurnExample } from "@chef/core";
import { HELDOUT_ITEMS, TRAIN_ITEMS, type BenchItem } from "../bench/items.ts";
import { renderReport, runForOutcomes } from "../bench/run.ts";

export interface SplitSummary {
  readonly items: number;
  readonly reviews: number;
  readonly approve: number;
  readonly reject: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly turns: number;
  readonly merges: number;
  readonly reverts: number;
  readonly seconds: number;
}

function summarize(items: readonly BenchItem[], reviews: readonly ReviewExample[], turns: readonly TurnExample[], merges: number, reverts: number, seconds: number): SplitSummary {
  const outcomes: Record<string, number> = {};
  for (const r of reviews) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  return { items: items.length, reviews: reviews.length, approve: reviews.filter((r) => r.label === "approve").length, reject: reviews.filter((r) => r.label === "reject").length, outcomes, turns: turns.length, merges, reverts, seconds };
}

export async function exportTuneData(out: string, options: { readonly concurrency?: number; readonly log?: (line: string) => void } = {}): Promise<Record<"train" | "heldout", SplitSummary>> {
  const log = options.log ?? (() => {});
  mkdirSync(out, { recursive: true });
  const summary: Partial<Record<"train" | "heldout", SplitSummary>> = {};
  for (const [split, items] of [["train", TRAIN_ITEMS], ["heldout", HELDOUT_ITEMS]] as const) {
    log(`running ${items.length} ${split} features with real checks`);
    const run = await runForOutcomes(items, { concurrency: options.concurrency ?? 3 });
    writeFileSync(join(out, `${split}.jsonl`), toJsonl(run.reviews));
    writeFileSync(join(out, `${split}-turns.jsonl`), toJsonl(run.turns));
    writeFileSync(join(out, `${split}-bench.md`), renderReport([run.result]));
    summary[split] = summarize(items, run.reviews, run.turns, run.result.merges, run.result.reverts, run.result.seconds);
    log(`${split}: ${run.reviews.length} reviews, ${run.turns.length} turns`);
  }
  const result = summary as Record<"train" | "heldout", SplitSummary>;
  writeFileSync(join(out, "summary.json"), `${JSON.stringify(result, null, 1)}\n`);
  return result;
}
