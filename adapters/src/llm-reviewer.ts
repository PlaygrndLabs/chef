import { z } from "zod";
import type { ReviewInput, ReviewVerdict, Reviewer } from "@kargah/core";
import { DEFAULT_MODEL, structured, type LlmEndpoint } from "./anthropic.ts";

const VerdictSchema = z.object({ approve: z.boolean(), reasons: z.array(z.string()) });

const SYSTEM = `You review one feature's diff against its spec for kargah. Approve only if every acceptance criterion is implemented and covered by a test named after its id, the diff stays inside the feature's slice, and nothing weakens an existing test. Each reason is one line the coder can act on. Approve with an empty reason list when nothing blocks.`;

export class LlmReviewer implements Reviewer {
  constructor(
    private readonly llm: LlmEndpoint,
    readonly model: string = DEFAULT_MODEL,
    private readonly maxDiffChars = 200_000,
  ) {}

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    let diff = Object.entries(input.diff)
      .map(([path, content]) => (content === null ? `--- deleted ${path}` : `--- ${path}\n${content}`))
      .join("\n\n");
    if (diff.length > this.maxDiffChars) return { approve: false, reasons: [`diff is ${diff.length} characters; split the feature so a review fits in ${this.maxDiffChars}`], model: this.model };
    diff = diff.trim();
    const result = await structured(this.llm, {
      model: this.model,
      system: SYSTEM,
      schema: VerdictSchema,
      prompt: `Spec:\n${JSON.stringify(input.feature, null, 2)}\n\nPrevious gate feedback:\n${input.checksLog || "none"}\n\nDiff:\n${diff}`,
    });
    return { approve: result.approve && result.reasons.length === 0, reasons: result.reasons, model: this.model };
  }
}
