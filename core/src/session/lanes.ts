import type { FileChanges, Tree } from "../git/tree.ts";
import type { WorkItem } from "../ports/planner.ts";
import type { FeatureSpec } from "../spec/schema.ts";

export interface Lane {
  readonly role: string;
  readonly branch: string;
  readonly items: readonly string[];
  readonly part: string | null;
  done: number;
  rework: boolean;
  feedback: string | null;
  head: string | null;
}

export type LaneStatus = "working" | "committed" | "unchanged" | "rejected" | "merged" | "conflict";

export interface LaneLayout {
  readonly changes: FileChanges;
  readonly parts: Readonly<Record<string, string>>;
}

export type LaneLayoutFor = (feature: FeatureSpec, roles: readonly string[], tree: Tree) => LaneLayout | null;

export const LANE_PREFIX = "lane/";

export function laneBranch(role: string): string {
  return `${LANE_PREFIX}${role}`;
}

export function planLanes(items: readonly WorkItem[], kinds: readonly WorkItem["kind"][]): Lane[] {
  const byRole = new Map<string, string[]>();
  for (const item of items) {
    if (!kinds.includes(item.kind)) continue;
    const list = byRole.get(item.role) ?? [];
    list.push(item.id);
    byRole.set(item.role, list);
  }
  return [...byRole].map(([role, ids]) => ({ role, branch: laneBranch(role), items: ids, part: null, done: 0, rework: false, feedback: null, head: null }));
}

export function laneItem(lane: Lane): string | null {
  if (lane.done < lane.items.length) return lane.items[lane.done] ?? null;
  return lane.rework ? (lane.items.at(-1) ?? null) : null;
}

export function lanesBusy(lanes: readonly Lane[] | null | undefined): boolean {
  return (lanes ?? []).some((lane) => laneItem(lane) !== null);
}

export function laneBrief(lane: Lane, lanes: readonly Lane[], items: readonly WorkItem[], featureId: string): string {
  const others = lanes.filter((other) => other !== lane);
  const work = (other: Lane) => {
    const item = items.find((i) => i.id === (laneItem(other) ?? other.items.at(-1)));
    const text = (item?.prompt ?? "").trim().replace(/\s+/g, " ");
    return text.length > 300 ? `${text.slice(0, 297)}...` : text;
  };
  return [
    `This feature is built by ${lanes.length} roles at the same time, each on its own branch. You are ${lane.role}, on ${lane.branch}. chef merges every role's branch into the feature after each turn, so the others' work shows up in your next turn.`,
    `The other roles are working on:\n${others.map((other) => `- ${other.role}: ${work(other)}`).join("\n")}`,
    lane.part
      ? `Keep to your part and write your files under ${lane.part.slice(0, lane.part.lastIndexOf("/") + 1)}. Export your routes from ${lane.part}; features/${featureId}/index.ts already combines every role's routes, so leave it as it is.`
      : "Keep to your part and avoid editing the same lines as the other roles. Where you need something another role builds, follow the contract in the work items (paths, data shapes, file names) instead of writing it yourself.",
  ].join("\n\n");
}
