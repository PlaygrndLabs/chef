import { describe, expect, it } from "vitest";
import { buildsDoc } from "../../src/orchestrator/orchestrator.ts";
import type { SessionRecord } from "../../src/session/record.ts";

const session = (id: string, state: string, reason = "", feedback: string | null = null) => ({ id, featureId: `f-${id}`, rootPrompt: `Build ${id}`, machine: { state, reason, feedback } }) as unknown as SessionRecord;

describe("builds for answering questions", () => {
  it("lists recent builds and says why a stuck one failed", () => {
    expect(buildsDoc([])).toBeNull();
    const doc = buildsDoc([session("s1", "merged", "merged"), session("s2", "stuck", "attempt budget exhausted (4/4)", "Merge gate failed:\n## test: FAILED\nnot ok 1 - saves a note")]);
    expect(doc?.text).toContain("- f-s1 (session s1, asked \"Build s1\"): merged");
    expect(doc?.text).toContain("- f-s2 (session s2, asked \"Build s2\"): stuck: attempt budget exhausted (4/4)");
    expect(doc?.text).toContain("What failed: Merge gate failed: ## test: FAILED not ok 1 - saves a note");
  });
});
