import type { PickCandidate, PickInput, PickVerdict, ReviewInput, ReviewVerdict, Reviewer } from "../ports/reviewer.ts";

export class RuleReviewer implements Reviewer {
  readonly model: string = "fake-rule-reviewer";
  readonly reviews: ReviewInput[] = [];

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    this.reviews.push(input);
    const reasons: string[] = [];
    let retest = false;
    const tests = Object.entries(input.diff).filter(([path, content]) => path.endsWith(".test.ts") && content !== null);
    const allTests = tests.map(([, content]) => content).join("\n");
    for (const criterion of input.feature.acceptance) {
      if (allTests.includes(`${criterion.id}:`)) continue;
      reasons.push(`no test named after ${criterion.id} (${criterion.text})`);
      retest = true;
    }
    const touched = Object.keys(input.diff);
    if (!touched.some((p) => p.startsWith(`features/${input.feature.id}/`) && !p.endsWith(".test.ts"))) reasons.push(`no implementation under features/${input.feature.id}/`);
    for (const [path, content] of Object.entries(input.diff)) if (content?.includes("<<<<<<<")) reasons.push(`unresolved conflict markers in ${path}`);
    return { approve: reasons.length === 0, reasons, retest, model: this.model };
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
