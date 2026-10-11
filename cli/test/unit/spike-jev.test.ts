import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChoiceAnswers, ChoiceQuestions, Classifier } from "@kargah/core";
import { report, runSpike, stats, sweep, type SpikeDataset } from "../../src/spike/jev.ts";
import { REPO_ROOT } from "../../src/world.ts";

const dataset = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "spikes", "jev-routing", "prompts.json"), "utf8")) as SpikeDataset;

function oracle(confidence: number, wrongFor: ReadonlySet<string> = new Set()): Classifier {
  const byText = new Map(dataset.items.map((item) => [item.prompt, item] as const));
  return {
    model: "oracle",
    async choose<const Q extends ChoiceQuestions>(state: unknown, questions: Q): Promise<ChoiceAnswers<Q>> {
      const item = byText.get((state as { prompt: string }).prompt);
      if (!item) throw new Error("unknown prompt");
      const truth: Record<string, string> = { intent: item.intent, feature: item.feature ?? "none", change: item.change ?? "extend" };
      if (wrongFor.has(item.id)) truth["intent"] = item.intent === "question" ? "new_feature" : "question";
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(questions)) answers[name] = { choice: truth[name], confidence, probabilities: {} };
      return answers as ChoiceAnswers<Q>;
    },
  };
}

describe("jev routing spike", () => {
  it("has at least 100 prompts, half English and half Persian", () => {
    expect(dataset.items.length).toBeGreaterThanOrEqual(100);
    expect(dataset.items.filter((i) => i.lang === "fa").length).toBe(dataset.items.filter((i) => i.lang === "en").length);
    const ids = new Set(dataset.features.map((f) => f.id));
    for (const item of dataset.items) if (item.intent === "change_feature") expect(ids.has(item.feature as string)).toBe(true);
  });

  it("scores a perfect confident classifier with no misroutes", async () => {
    const results = await runSpike(oracle(0.95), dataset, ["raw"]);
    const s = stats(results);
    expect(s.intentTop1).toBe(s.total);
    expect(s.misrouted).toBe(0);
    expect(s.accepted).toBe(s.total);
  });

  it("defers low-confidence answers and counts confident wrong ones as misroutes", async () => {
    const results = await runSpike(oracle(0.95, new Set(["fa-01", "fa-02"])), dataset, ["raw"]);
    expect(stats(results).misrouted).toBe(2);
    const low = await runSpike(oracle(0.3), dataset, ["raw"]);
    expect(stats(low).accepted).toBe(low.filter((r) => r.rules !== null).length);
    expect(sweep(low).every((row) => row.coverage === 0)).toBe(true);
    expect(report("oracle", results)).toContain("fa-01");
  });
});
