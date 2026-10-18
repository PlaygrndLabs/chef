import type { PickCandidate, PickInput, PickVerdict, ReviewInput, ReviewVerdict, Reviewer } from "../ports/reviewer.ts";
import { TEST_GLOBS } from "../structure/structure.ts";
import { matchesScope } from "../util/glob.ts";

export class RuleReviewer implements Reviewer {
  readonly model: string = "fake-rule-reviewer";
  readonly reviews: ReviewInput[] = [];

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    this.reviews.push(input);
    if (input.chore) return this.reviewChore(input);
    const reasons: string[] = [];
    let retest = false;
    const isTest = (path: string) => (input.ownStructure ? matchesScope(path, [...TEST_GLOBS, "!spec/features/**"]) : path.endsWith(".test.ts"));
    const tests = Object.entries(input.diff).filter(([path, content]) => isTest(path) && content !== null);
    const allTests = tests.map(([, content]) => content).join("\n");
    for (const criterion of input.feature.acceptance) {
      if (allTests.includes(`${criterion.id}:`)) continue;
      reasons.push(`no test named after ${criterion.id} (${criterion.text})`);
      retest = true;
    }
    const touched = Object.keys(input.diff);
    if (input.ownStructure) {
      if (!touched.some((p) => !isTest(p) && !p.startsWith("spec/features/"))) reasons.push("no implementation outside the tests");
    } else if (!touched.some((p) => p.startsWith(`features/${input.feature.id}/`) && !p.endsWith(".test.ts"))) reasons.push(`no implementation under features/${input.feature.id}/`);
    for (const [path, content] of Object.entries(input.diff)) if (content?.includes("<<<<<<<")) reasons.push(`unresolved conflict markers in ${path}`);
    return { approve: reasons.length === 0, reasons, retest, model: this.model };
  }

  private reviewChore(input: ReviewInput): ReviewVerdict {
    const reasons: string[] = [];
    if (Object.keys(input.diff).length === 0) reasons.push("the chore changed nothing");
    for (const [path, content] of Object.entries(input.diff)) {
      if (path.endsWith(".test.ts") && content === null) reasons.push(`a chore must not delete the test ${path}`);
      if (content?.includes("<<<<<<<")) reasons.push(`unresolved conflict markers in ${path}`);
    }
    return { approve: reasons.length === 0, reasons, retest: false, model: this.model };
  }

  async pick(input: PickInput): Promise<PickVerdict> {
    const ranked = [...input.candidates].sort((a, b) => score(b) - score(a) || b.crossTests.passed - a.crossTests.passed || size(a) - size(b));
    const winner = ranked[0];
    if (!winner) throw new Error("no candidates to pick from");
    const reasons = ranked.map((c) => `${c.sessionId}: ${c.crossTests.passed}/${c.crossTests.total} tests from every attempt pass, ${size(c)} changed lines`);
    return { sessionId: winner.sessionId, reasons, model: this.model };
  }
}

function score(candidate: PickCandidate): number {
  return candidate.crossTests.total === 0 ? 0 : candidate.crossTests.passed / candidate.crossTests.total;
}

function size(candidate: PickCandidate): number {
  return Object.values(candidate.diff).reduce((sum, content) => sum + (content?.split("\n").length ?? 1), 0);
}
