import type { FileChanges } from "../git/tree.ts";
import type { FeatureSpec } from "../spec/schema.ts";

export interface ReviewInput {
  readonly feature: FeatureSpec;
  readonly diff: FileChanges;
  readonly checksLog: string;
}

export interface ReviewVerdict {
  readonly approve: boolean;
  readonly reasons: readonly string[];
  readonly model: string;
}

export interface Reviewer {
  review(input: ReviewInput): Promise<ReviewVerdict>;
}
