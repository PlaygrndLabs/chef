import type { FileChanges } from "../git/tree.ts";
import type { FeatureSpec } from "../spec/schema.ts";

export interface ReviewInput {
  readonly feature: FeatureSpec;
  readonly diff: FileChanges;
  readonly checksLog: string;
  readonly chore?: boolean;
}

export interface ReviewVerdict {
  readonly approve: boolean;
  readonly reasons: readonly string[];
  readonly retest?: boolean;
  readonly model: string;
}

export interface AttemptScore {
  readonly sessionId: string;
  readonly passed: number;
  readonly total: number;
}

export interface PickCandidate {
  readonly sessionId: string;
  readonly diff: FileChanges;
  readonly crossTests: AttemptScore & { readonly log: string };
}

export interface PickInput {
  readonly feature: FeatureSpec;
  readonly candidates: readonly PickCandidate[];
}

export interface PickVerdict {
  readonly sessionId: string;
  readonly reasons: readonly string[];
  readonly model: string;
}

export interface Reviewer {
  readonly model?: string;
  review(input: ReviewInput): Promise<ReviewVerdict>;
  pick(input: PickInput): Promise<PickVerdict>;
}
