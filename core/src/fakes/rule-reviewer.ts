import type { ReviewInput, ReviewVerdict, Reviewer } from "../ports/reviewer.ts";

export class RuleReviewer implements Reviewer {
  readonly model = "fake-rule-reviewer";
  readonly reviews: ReviewInput[] = [];

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    this.reviews.push(input);
    const reasons: string[] = [];
    const tests = Object.entries(input.diff).filter(([path, content]) => path.endsWith(".test.ts") && content !== null);
    const allTests = tests.map(([, content]) => content).join("\n");
    for (const criterion of input.feature.acceptance) {
      if (!allTests.includes(`${criterion.id}:`)) reasons.push(`no test named after ${criterion.id} (${criterion.text})`);
    }
    const touched = Object.keys(input.diff);
    if (!touched.some((p) => p.startsWith(`features/${input.feature.id}/`) && !p.endsWith(".test.ts"))) reasons.push(`no implementation under features/${input.feature.id}/`);
    for (const [path, content] of Object.entries(input.diff)) if (content?.includes("<<<<<<<")) reasons.push(`unresolved conflict markers in ${path}`);
    return { approve: reasons.length === 0, reasons, model: this.model };
  }
}
