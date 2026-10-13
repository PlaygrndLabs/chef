import { z } from "zod";
import { FEATURE_ID, type FeatureSpec } from "./schema.ts";

export interface FeaturePlace {
  readonly title?: string;
  readonly parent?: string | null;
  readonly removedAt?: number;
}

export type FeatureLayout = Readonly<Record<string, FeaturePlace>>;

export const FeatureArrangement = z.strictObject({
  title: z.string().trim().min(1, "the title needs text").max(120).optional(),
  parent: z.string().regex(FEATURE_ID).max(40).nullable().optional(),
});

export type FeatureArrangement = z.infer<typeof FeatureArrangement>;

export interface KnownFeature {
  readonly id: string;
  readonly title: string;
  readonly parent: string | null;
}

export function placed(feature: KnownFeature, layout: FeatureLayout): KnownFeature {
  const place = layout[feature.id];
  if (!place) return feature;
  return { id: feature.id, title: place.title ?? feature.title, parent: place.parent !== undefined ? place.parent : feature.parent };
}

export function arrangedSpec(spec: readonly FeatureSpec[], layout: FeatureLayout): FeatureSpec[] {
  return spec.map((feature) => {
    const place = layout[feature.id];
    if (!place) return feature;
    const { parent: _parent, ...rest } = feature;
    const parent = place.parent !== undefined ? place.parent : (feature.parent ?? null);
    return { ...rest, title: place.title ?? feature.title, ...(parent ? { parent } : {}) };
  });
}

export function subtreeOf(id: string, features: readonly KnownFeature[]): string[] {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) for (const f of features) if (f.parent === ids[i] && !ids.includes(f.id)) ids.push(f.id);
  return ids;
}

export function arrangementProblem(id: string, change: FeatureArrangement, features: readonly KnownFeature[]): string | null {
  if (!features.some((f) => f.id === id)) return `unknown feature ${id}`;
  const parent = change.parent;
  if (!parent) return null;
  if (!features.some((f) => f.id === parent)) return `unknown feature ${parent}`;
  if (subtreeOf(id, features).includes(parent)) return "a feature cannot go under itself or one of its own parts";
  return null;
}

export function arrange(layout: FeatureLayout, id: string, change: FeatureArrangement): FeatureLayout {
  const place: FeaturePlace = { ...layout[id], ...(change.title !== undefined ? { title: change.title } : {}), ...(change.parent !== undefined ? { parent: change.parent } : {}) };
  return { ...layout, [id]: place };
}

export function markRemoved(layout: FeatureLayout, ids: readonly string[], at: number): FeatureLayout {
  const next: Record<string, FeaturePlace> = { ...layout };
  for (const id of ids) next[id] = { ...next[id], removedAt: at };
  return next;
}
