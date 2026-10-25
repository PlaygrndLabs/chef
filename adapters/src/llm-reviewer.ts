import { z } from "zod";
import { isLockfile, withGuidance, type Effort, type FileChanges, type PickInput, type PickVerdict, type ReviewInput, type ReviewVerdict, type Reviewer } from "@chef/core";
import { structured, type LlmEndpoint } from "./anthropic.ts";

const VerdictSchema = z.object({ approve: z.boolean(), reasons: z.array(z.string()), retest: z.boolean() });

const PickSchema = z.object({ sessionId: z.string(), reasons: z.array(z.string()) });

const PICK_SYSTEM = `You pick one of several competing attempts at the same chef feature. Each attempt's code was run against the tests written by every attempt; prefer the attempt that passes the most of them, then the one that best matches the spec, then the smaller diff. Answer with the chosen sessionId and one line per reason.`;

const UNTESTED_NOTE = "Tests are off for this project, so no new tests are expected and none are named after criteria. Judge the code itself against the spec, and never set retest.";

const CHORE_NOTE = "This is a chore: maintenance outside any one feature, not a feature build, so there is no spec and no new tests are expected. Approve if the diff does the task, changes no feature's behavior, and weakens no test. Reject work the task does not ask for, such as Docker, CI or dependency changes in a task about something else, and name the files to take out. Never set retest for a chore.";

export class LlmReviewer implements Reviewer {
  constructor(
    private readonly llm: LlmEndpoint,
    readonly model: string,
    private readonly system: string,
    private readonly maxDiffChars = 200_000,
    private readonly effort: Effort | null = null,
  ) {}

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    const diff = renderDiff(input.diff);
    if (diff.length > this.maxDiffChars) return { approve: false, reasons: [`diff is ${diff.length} characters; split the feature so a review fits in ${this.maxDiffChars}`], model: this.model };
    const existing = renderExisting(input.existing, this.maxDiffChars - diff.length);
    const result = await structured(this.llm, {
      model: this.model,
      system: withGuidance(this.system, input.guidance),
      ...(this.effort ? { effort: this.effort } : {}),
      schema: VerdictSchema,
      prompt: `${input.chore ? `${CHORE_NOTE}\n\nTask:\n${input.feature.body}` : `${input.untested ? `${UNTESTED_NOTE}\n\n` : ""}Spec:\n${JSON.stringify(input.feature, null, 2)}${renderScope(input.scope)}`}\n\nPrevious gate feedback:\n${input.checksLog || "none"}\n\nDiff:\n${diff}${existing}`,
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
      ...(this.effort ? { effort: this.effort } : {}),
      schema: PickSchema,
      prompt: `Spec:\n${JSON.stringify(input.feature, null, 2)}\n\nAttempts (${ids.join(", ")}):\n\n${attempts}`,
    });
    if (!ids.includes(result.sessionId)) throw new Error(`reviewer picked unknown attempt ${result.sessionId}`);
    return { sessionId: result.sessionId, reasons: result.reasons, model: this.model };
  }
}

function renderScope(scope: readonly string[] | undefined): string {
  if (!scope?.length) return "";
  return `\n\nThis feature's slice: the paths it may change. chef blocks writes anywhere else, so never reject a change for touching these:\n${scope.map((pattern) => `- ${pattern}`).join("\n")}`;
}

function renderExisting(existing: FileChanges | undefined, budget: number): string {
  const files = renderDiff(existing ?? {});
  if (!files) return "";
  const shown = files.length > budget ? `${files.slice(0, Math.max(0, budget))}\n(cut off: the rest of these files did not fit)` : files;
  return `\n\nAlready in this feature's slice and unchanged by the diff, so what they do counts toward the criteria:\n${shown}`;
}

function renderDiff(diff: FileChanges): string {
  return Object.entries(diff)
    .map(([path, content]) => (content === null ? `--- deleted ${path}` : isLockfile(path) ? `--- ${path} (lockfile the package manager wrote, ${content.length} characters, not shown)` : `--- ${path}\n${content}`))
    .join("\n\n")
    .trim();
}
