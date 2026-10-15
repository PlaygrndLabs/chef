import { freeName, featureSlug, type FeatureMap, type MapEntry, type MapState } from "./map.ts";

export interface MappedFeature {
  readonly name: string;
  readonly title: string;
  readonly parent: string | null;
  readonly path: string;
}

export interface MappedFeatures {
  readonly start: string;
  readonly features: readonly MappedFeature[];
}

const MAX_DEPTH = 8;
const MAX_FEATURES = 200;

export function placeMapped(map: FeatureMap, mapped: MappedFeatures, state: MapState = "current"): { readonly start?: string; readonly entries: readonly MapEntry[] } {
  const ids = new Map<string, string>(map.features.map((f) => [f.name, f.id]));
  const taken = new Set<string>();
  const entries: MapEntry[] = [];
  const pending = mapped.features
    .filter((f) => f.title.trim())
    .slice(0, MAX_FEATURES)
    .map((f) => ({ ...f, name: featureSlug(f.name || f.title), parent: f.parent ? featureSlug(f.parent) : null }));
  const names = new Set(pending.map((f) => f.name));
  const place = (feature: (typeof pending)[number], parentId: string | null) => {
    if (ids.has(feature.name)) return;
    const name = freeName(map, feature.name, taken);
    taken.add(name);
    const depth = parentId ? parentId.split("/").length : 0;
    const id = parentId && depth < MAX_DEPTH ? `${parentId}/${name}` : name;
    ids.set(feature.name, id);
    entries.push({ id, title: feature.title.trim().slice(0, 120), state, path: feature.path.trim() });
  };
  let left = pending;
  while (left.length) {
    const next = left.filter((f) => {
      if (ids.has(f.name)) return false;
      if (!f.parent || f.parent === f.name || !names.has(f.parent) || ids.has(f.parent)) {
        place(f, f.parent && f.parent !== f.name ? (ids.get(f.parent) ?? null) : null);
        return false;
      }
      return true;
    });
    if (next.length === left.length) {
      const [first, ...rest] = next;
      if (first) place(first, null);
      left = rest;
    } else left = next;
  }
  const start = mapped.start.trim();
  return { ...(start && !map.start ? { start } : {}), entries };
}

export function describeEntries(entries: readonly MapEntry[]): string {
  return entries.map((e) => `${"  ".repeat(e.id.split("/").length - 1)}- ${e.title}`).join("\n");
}


