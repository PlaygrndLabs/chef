import { z } from "zod";
import type { FileChanges, PickInput, PickVerdict, ReviewInput, ReviewVerdict, Reviewer } from "@kargah/core";
import { DEFAULT_MODEL, structured, type LlmEndpoint } from "./anthropic.ts";

const VerdictSchema = z.object({ approve: z.boolean(), reasons: z.array(z.string()) });

const PickSchema = z.object({ sessionId: z.string(), reasons: z.array(z.string()) });

const SYSTEM = `You review one feature's diff against its spec for kargah. Approve only if every acceptance criterion is implemented and covered by a test named after its id, the diff stays inside the feature's slice, and nothing weakens an existing test. Each reason is one line the coder can act on. Approve with an empty reason list when nothing blocks.`;

const PICK_SYSTEM = `You pick one of several competing attempts at the same kargah feature. Each attempt's code was run against the tests written by every attempt; prefer the attempt that passes the most of them, then the one that best matches the spec, then the smaller diff. Answer with the chosen sessionId and one line per reason.`;

export class LlmReviewer implements Reviewer {
  constructor(
    private readonly llm: LlmEndpoint,
    readonly model: string = DEFAULT_MODEL,
    private readonly maxDiffChars = 200_000,
  ) {}

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    const diff = renderDiff(input.diff);
    if (diff.length > this.maxDiffChars) return { approve: false, reasons: [`diff is ${diff.length} characters; split the feature so a review fits in ${this.maxDiffChars}`], model: this.model };
    const result = await structured(this.llm, {
      model: this.model,
      system: SYSTEM,
      schema: VerdictSchema,
      prompt: `Spec:\n${JSON.stringify(input.feature, null, 2)}\n\nPrevious gate feedback:\n${input.checksLog || "none"}\n\nDiff:\n${diff}`,
    });
    return { approve: result.approve && result.reasons.length === 0, reasons: result.reasons, model: this.model };
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
