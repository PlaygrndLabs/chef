import {
  decideFromAnswers,
  DEFAULT_ROUTER_CONFIG,
  routeByRules,
  routingQuestions,
  type Classifier,
  type FeatureSpec,
  type RouteDecision,
  type RouterConfig,
  type RoutingAnswers,
} from "@kargah/core";

export type SpikeMode = "raw" | "translated";

export interface SpikeItem {
  readonly id: string;
  readonly lang: "en" | "fa";
  readonly prompt: string;
  readonly english: string;
  readonly intent: RouteDecision["intent"];
  readonly feature: string | null;
  readonly change: RouteDecision["changeKind"];
}

export interface SpikeDataset {
  readonly features: readonly { readonly id: string; readonly title: string }[];
  readonly items: readonly SpikeItem[];
}

export interface ItemResult {
  readonly item: SpikeItem;
  readonly mode: SpikeMode;
  readonly text: string;
  readonly rules: RouteDecision | null;
  readonly answers: RoutingAnswers;
  readonly decision: RouteDecision | null;
}

export interface SliceStats {
  readonly total: number;
  readonly intentTop1: number;
  readonly featureTop1: number;
  readonly changeTop1: number;
  readonly changeItems: number;
  readonly accepted: number;
  readonly misrouted: number;
}

export interface SweepRow {
  readonly threshold: number;
  readonly coverage: number;
  readonly misrouteRate: number;
}

export function specFor(dataset: SpikeDataset): FeatureSpec[] {
  return dataset.features.map((f) => ({
    id: f.id,
    title: f.title,
    status: "merged",
    entrypoint: "",
    revision: 1,
    shared: [],
    acceptance: [{ id: "AC1", text: f.title }],
    body: f.title,
  }));
}

export function isCorrect(item: SpikeItem, decision: RouteDecision): boolean {
  if (decision.intent !== item.intent) return false;
  return item.intent !== "change_feature" || decision.featureId === item.feature;
}

export async function runSpike(
  classifier: Classifier,
  dataset: SpikeDataset,
  modes: readonly SpikeMode[],
  config: RouterConfig = DEFAULT_ROUTER_CONFIG,
  onItem: (result: ItemResult) => void = () => undefined,
): Promise<ItemResult[]> {
  const spec = specFor(dataset);
  const results: ItemResult[] = [];
  for (const mode of modes) {
    for (const item of dataset.items) {
      const text = mode === "raw" ? item.prompt : item.english;
      const { state, questions } = routingQuestions(text, spec);
      const answers = await classifier.choose(state, questions);
      const rules = routeByRules(text, spec);
      const decision = rules ?? decideFromAnswers(answers, config, classifier.model);
      const result = { item, mode, text, rules, answers, decision };
      results.push(result);
      onItem(result);
    }
  }
  return results;
}

export function stats(results: readonly ItemResult[]): SliceStats {
  const change = results.filter((r) => r.item.intent === "change_feature");
  return {
    total: results.length,
    intentTop1: results.filter((r) => r.answers.intent.choice === r.item.intent).length,
    featureTop1: change.filter((r) => r.answers.feature.choice === r.item.feature).length,
    changeTop1: change.filter((r) => r.answers.change.choice === r.item.change).length,
    changeItems: change.length,
    accepted: results.filter((r) => r.decision !== null).length,
    misrouted: results.filter((r) => r.decision !== null && !isCorrect(r.item, r.decision)).length,
  };
}

export function sweep(results: readonly ItemResult[], thresholds: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]): SweepRow[] {
  return thresholds.map((threshold) => {
    const config: RouterConfig = { thresholds: { new_feature: threshold, change_feature: threshold, question: threshold }, featureThreshold: threshold };
    const accepted = results.map((r) => ({ r, d: decideFromAnswers(r.answers, config, "sweep") })).filter((x) => x.d !== null);
    const wrong = accepted.filter((x) => !isCorrect(x.r.item, x.d as RouteDecision)).length;
    return { threshold, coverage: accepted.length / Math.max(1, results.length), misrouteRate: wrong / Math.max(1, results.length) };
  });
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

export function report(model: string, results: readonly ItemResult[], config: RouterConfig = DEFAULT_ROUTER_CONFIG): string {
  const lines: string[] = [];
  lines.push(`# Jev routing results: ${model}`, "");
  lines.push(`Thresholds: new ${config.thresholds.new_feature}, change ${config.thresholds.change_feature}, question ${config.thresholds.question}, feature ${config.featureThreshold}.`, "");
  lines.push("Accepted means the rules or the classifier decided without the planner. Misrouted means accepted and wrong, counted over all prompts in the slice.", "");
  lines.push("| Mode | Lang | Prompts | Intent top-1 | Feature top-1 | Change kind top-1 | Accepted | Misrouted |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  const slices: [SpikeMode, string][] = [];
  for (const mode of ["raw", "translated"] as const) for (const lang of ["en", "fa", "all"]) slices.push([mode, lang]);
  for (const [mode, lang] of slices) {
    const slice = results.filter((r) => r.mode === mode && (lang === "all" || r.item.lang === lang));
    if (slice.length === 0) continue;
    const s = stats(slice);
    lines.push(
      `| ${mode} | ${lang} | ${s.total} | ${pct(s.intentTop1, s.total)} | ${pct(s.featureTop1, s.changeItems)} | ${pct(s.changeTop1, s.changeItems)} | ${pct(s.accepted, s.total)} | ${pct(s.misrouted, s.total)} |`,
    );
  }
  lines.push("", "## Classifier-only threshold sweep", "", "Rules excluded; one threshold for every action and for the feature question.", "");
  lines.push("| Mode | Lang | Threshold | Coverage | Misroute rate |", "| --- | --- | --- | --- | --- |");
  for (const [mode, lang] of slices) {
    const slice = results.filter((r) => r.mode === mode && (lang === "all" || r.item.lang === lang));
    if (slice.length === 0 || lang === "all") continue;
    for (const row of sweep(slice)) lines.push(`| ${mode} | ${lang} | ${row.threshold} | ${(100 * row.coverage).toFixed(1)}% | ${(100 * row.misrouteRate).toFixed(1)}% |`);
  }
  const misroutes = results.filter((r) => r.decision !== null && !isCorrect(r.item, r.decision));
  lines.push("", "## Accepted misroutes", "");
  if (misroutes.length === 0) lines.push("None.");
  for (const r of misroutes) {
    const d = r.decision as RouteDecision;
    lines.push(`- ${r.mode} ${r.item.id}: expected ${r.item.intent}${r.item.feature ? `/${r.item.feature}` : ""}, got ${d.intent}${d.featureId ? `/${d.featureId}` : ""} via ${d.via} (${d.confidence.toFixed(2)}): ${r.text}`);
  }
  return `${lines.join("\n")}\n`;
}
