import { z } from "zod";
import { withGuidance, type FileChanges, type PickInput, type PickVerdict, type ReviewInput, type ReviewVerdict, type Reviewer } from "@chef/core";
import { structured, type LlmEndpoint } from "./anthropic.ts";

const VerdictSchema = z.object({ approve: z.boolean(), reasons: z.array(z.string()), retest: z.boolean() });

const PickSchema = z.object({ sessionId: z.string(), reasons: z.array(z.string()) });

const PICK_SYSTEM = `You pick one of several competing attempts at the same chef feature. Each attempt's code was run against the tests written by every attempt; prefer the attempt that passes the most of them, then the one that best matches the spec, then the smaller diff. Answer with the chosen sessionId and one line per reason.`;

const CHORE_NOTE = "This is a chore: maintenance outside any one feature, not a feature build, so there is no spec and no new tests are expected. Approve if the diff does the task, changes no feature's behavior, and weakens no test. Never set retest for a chore.";

export class LlmReviewer implements Reviewer {
  constructor(
    private readonly llm: LlmEndpoint,
    readonly model: string,
    private readonly system: string,
    private readonly maxDiffChars = 200_000,
  ) {}

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    const diff = renderDiff(input.diff);
    if (diff.length > this.maxDiffChars) return { approve: false, reasons: [`diff is ${diff.length} characters; split the feature so a review fits in ${this.maxDiffChars}`], model: this.model };
    const result = await structured(this.llm, {
      model: this.model,
      system: withGuidance(this.system, input.guidance),
      schema: VerdictSchema,
      prompt: `${input.chore ? `${CHORE_NOTE}\n\nTask:\n${input.feature.body}` : `Spec:\n${JSON.stringify(input.feature, null, 2)}`}\n\nPrevious gate feedback:\n${input.checksLog || "none"}\n\nDiff:\n${diff}`,
    });
    return { approve: result.approve && result.reasons.length === 0, reasons: result.reasons, retest: result.retest, model: this.model };
  }

  async pick(input: PickInput): Promise<PickVerdict> {
    const ids = input.candidates.map((c) => c.sessionId);
    const budget = Math.floor(this.maxDiffChars / Math.max(1, input.candidates.length));
    const attempts = input.candidates
      .map((c) => `## ${c.sessionId}\nCross tests: ${c.crossTests.passed}/${c.crossTests.total} passed\n${c.crossTests.log.slice(-2000)}\n\nDiff:\n${renderDiff(c.diff).slice(0, budget)}`)
      .join("\n\n");
    const result = await structured(this.llm, {
      model: this.model,
      system: PICK_SYSTEM,
      schema: PickSchema,
      prompt: `Spec:\n${JSON.stringify(input.feature, null, 2)}\n\nAttempts (${ids.join(", ")}):\n\n${attempts}`,
    });
    if (!ids.includes(result.sessionId)) throw new Error(`reviewer picked unknown attempt ${result.sessionId}`);
    return { sessionId: result.sessionId, reasons: result.reasons, model: this.model };
  }
}

function renderDiff(diff: FileChanges): string {
  return Object.entries(diff)
    .map(([path, content]) => (content === null ? `--- deleted ${path}` : `--- ${path}\n${content}`))
    .join("\n\n")
    .trim();
}
