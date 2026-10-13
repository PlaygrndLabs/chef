import { z } from "zod";
import { ENV_NAME } from "../env/env.ts";

export const FEATURE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const AcceptanceCriterion = z.strictObject({
  id: z.string().regex(/^AC[1-9][0-9]*$/),
  text: z.string().min(1),
});

export const FeatureStatus = z.enum(["proposed", "building", "merged", "stuck"]);

export const FeatureFrontmatter = z.strictObject({
  id: z.string().regex(FEATURE_ID).max(40),
  title: z.string().min(1).max(120),
  status: FeatureStatus,
  entrypoint: z.string().min(1),
  flow: z.string().regex(FEATURE_ID).optional(),
  revision: z.number().int().positive().default(1),
  shared: z.array(z.string().regex(/^shared\/[A-Za-z0-9_./-]+$/)).default([]),
  env: z.array(z.string().regex(ENV_NAME, "env names use capital letters, digits and _")).default([]),
  acceptance: z.array(AcceptanceCriterion).min(1),
});

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;
export type FeatureStatus = z.infer<typeof FeatureStatus>;
export type FeatureFrontmatter = z.infer<typeof FeatureFrontmatter>;

export interface FeatureSpec extends FeatureFrontmatter {
  readonly body: string;
}

export function featureFlow(spec: FeatureSpec): string {
  return spec.flow ?? spec.id;
}

export function specPath(id: string): string {
  return `spec/features/${id}.md`;
}
