import { describe, expect, it } from "vitest";
import type { ChoiceAnswers, ChoiceQuestions, Classifier } from "../../src/ports/classifier.ts";
import { DEFAULT_ROUTER_CONFIG, DEFAULT_WORDING, Router } from "../../src/router/router.ts";
import { TemplatePlanner } from "../../src/fakes/template-planner.ts";
import { KeywordClassifier } from "../../src/fakes/keyword-classifier.ts";
import { todoSpec } from "../harness.ts";

class FixedClassifier implements Classifier {
  readonly model = "fixed";
  constructor(private readonly answers: Record<string, { choice: string; confidence: number }>) {}
  async choose<const Q extends ChoiceQuestions>(_state: unknown, questions: Q): Promise<ChoiceAnswers<Q>> {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(questions)) out[name] = { probabilities: {}, ...(this.answers[name] ?? { choice: "none", confidence: 0 }) };
    return out as ChoiceAnswers<Q>;
  }
}

describe("router", () => {
  const spec = [todoSpec];

  it("routes by rules first", async () => {
    const router = new Router({ classifier: new KeywordClassifier(), planner: new TemplatePlanner() });
    expect(await router.route("@todo-add fix the crash on empty text", spec)).toMatchObject({ intent: "change_feature", featureId: "todo-add", changeKind: "bug", via: "rules" });
    expect(await router.route("/new dark mode", spec)).toMatchObject({ intent: "new_feature", via: "rules" });
    expect(await router.route("how does the todo list store items?", spec)).toMatchObject({ intent: "question", via: "rules" });
  });

  it("routes /chore by rules and marks hotfixes as bug fixes in the hotfix lane", async () => {
    const router = new Router({ classifier: new KeywordClassifier(), planner: new TemplatePlanner() });
    expect(await router.route("/chore upgrade the test runner", spec)).toMatchObject({ intent: "chore", via: "rules" });
    expect(await router.route("/hotfix @todo-add items vanish after adding", spec)).toMatchObject({ intent: "change_feature", featureId: "todo-add", changeKind: "bug", hotfix: true });
    expect(await router.route("/hotfix /chore the deploy config is wrong", spec)).toMatchObject({ intent: "chore", hotfix: true });
    expect(await router.route("@todo-add add a due date", spec)).not.toHaveProperty("hotfix");
    expect(await router.route("/hotfix how does the todo list store items?", spec)).not.toHaveProperty("hotfix");
  });

  it("accepts a confident classifier answer", async () => {
    const classifier = new FixedClassifier({ intent: { choice: "change_feature", confidence: 0.95 }, feature: { choice: "todo-add", confidence: 0.9 }, change: { choice: "extend", confidence: 0.9 } });
    const router = new Router({ classifier, planner: new TemplatePlanner() });
    expect(await router.route("let people mark todos as important", spec)).toMatchObject({ intent: "change_feature", featureId: "todo-add", changeKind: "extend", via: "classifier" });
  });

  it("falls back to the planner when the classifier is unsure", async () => {
    const classifier = new FixedClassifier({ intent: { choice: "change_feature", confidence: 0.4 } });
    const planner = new TemplatePlanner();
    const router = new Router({ classifier, planner });
    const decision = await router.route("Add an item to a todo list faster", spec);
    expect(decision.via).toBe("planner");
    expect(planner.triaged).toHaveLength(1);
  });

  it("keeps what the classifier said even when the planner decides", async () => {
    const classifier = new FixedClassifier({ intent: { choice: "change_feature", confidence: 0.4 } });
    const decision = await new Router({ classifier, planner: new TemplatePlanner() }).route("Add an item to a todo list faster", spec);
    expect(decision.classifier).toMatchObject({ model: "fixed", accepted: false, answers: { intent: { choice: "change_feature", confidence: 0.4 } } });
  });

  it("asks the classifier the configured wording and skips it when turned off", async () => {
    const asked: unknown[] = [];
    const classifier: Classifier = {
      model: "spy",
      async choose(state, questions) {
        asked.push(questions);
        return new FixedClassifier({ intent: { choice: "new_feature", confidence: 0.99 } }).choose(state, questions);
      },
    };
    const wording = { ...DEFAULT_WORDING, intent: { ...DEFAULT_WORDING.intent, instructions: "Is this new work?" } };
    const decision = await new Router({ classifier, planner: new TemplatePlanner() }, { ...DEFAULT_ROUTER_CONFIG, wording }).route("dark mode please", spec);
    expect(decision).toMatchObject({ intent: "new_feature", via: "classifier", classifier: { accepted: true } });
    expect(asked[0]).toMatchObject({ intent: { instructions: "Is this new work?" } });
    const off = await new Router({ classifier, planner: new TemplatePlanner() }, { ...DEFAULT_ROUTER_CONFIG, useClassifier: false }).route("dark mode please", spec);
    expect(off.via).toBe("planner");
    expect(asked).toHaveLength(1);
  });
});
