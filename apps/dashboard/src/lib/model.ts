import type { FeatureLayout, FeatureSpec, SessionRecord, SessionState } from "@chef/core";
import { isActive, type ProjectLive, type SessionLive } from "./events";

export type FeatureStatus = "building" | "stuck" | "merged" | "proposed" | "dropped";

export function statusOf(state: SessionState): FeatureStatus {
  if (state === "merged") return "merged";
  if (state === "stuck") return "stuck";
  if (state === "dropped") return "dropped";
  return "building";
}

export interface SessionNode {
  readonly id: string;
  readonly featureId: string;
  readonly state: SessionState;
  readonly attempt: { readonly group: string; readonly index: number; readonly of: number } | null;
  readonly parent: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly needs: readonly string[];
  readonly live: SessionLive | undefined;
  readonly record: SessionRecord | undefined;
}

export interface FeatureNode {
  readonly id: string;
  readonly title: string;
  readonly status: FeatureStatus;
  readonly flow: string;
  readonly spec: FeatureSpec | null;
  readonly onMain: boolean;
  readonly parent: string | null;
  readonly sessions: readonly SessionNode[];
  readonly preview: { readonly url: string; readonly commitId: string; readonly link?: string | undefined; readonly sessionId: string } | null;
  readonly updatedAt: number;
}

export function sessionNodes(live: ProjectLive, records: readonly SessionRecord[]): SessionNode[] {
  const byId = new Map<string, SessionNode>();
  for (const record of records) {
    const l = live.sessions[record.id];
    byId.set(record.id, { id: record.id, featureId: record.featureId, state: l?.state ?? record.machine.state, attempt: record.attempt, parent: record.parent, createdAt: record.createdAt, updatedAt: Math.max(record.updatedAt, l?.updatedAt ?? 0), needs: l && l.updatedAt >= record.updatedAt ? l.needs : (record.needs ?? []), live: l, record });
  }
  for (const id of live.order) {
    const l = live.sessions[id];
    if (!l || byId.has(id)) continue;
    byId.set(id, { id, featureId: l.featureId, state: l.state, attempt: l.attempt, parent: l.parent, createdAt: l.createdAt, updatedAt: l.updatedAt, needs: l.needs, live: l, record: undefined });
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function featureStatusOf(sessions: readonly SessionNode[], spec: FeatureSpec | null): FeatureStatus {
  if (sessions.some((s) => isActive(s.state))) return "building";
  const latest = [...sessions].reverse().find((s) => s.state !== "dropped");
  if (latest?.state === "stuck") return "stuck";
  if (spec?.status === "merged" || sessions.some((s) => s.state === "merged")) return "merged";
  if (spec) return spec.status === "stuck" ? "stuck" : spec.status === "building" ? "proposed" : spec.status;
  return sessions.length ? "dropped" : "proposed";
}

export function featureNodes(live: ProjectLive, records: readonly SessionRecord[], spec: readonly FeatureSpec[], layout: FeatureLayout = {}): FeatureNode[] {
  const sessions = sessionNodes(live, records);
  const ids = new Set<string>([...spec.map((f) => f.id), ...sessions.map((s) => s.featureId)]);
  const nodes: FeatureNode[] = [];
  for (const id of ids) {
    const place = layout[id];
    const removedAt = place?.removedAt;
    const own = sessions.filter((s) => s.featureId === id && (removedAt === undefined || s.createdAt > removedAt));
    if (removedAt !== undefined && own.length === 0) continue;
    const fromMain = spec.find((f) => f.id === id) ?? null;
    const planned = [...own].reverse().find((s) => s.record)?.record?.plan.feature ?? null;
    const feature = fromMain ?? planned;
    const preview = live.previews[id] ?? null;
    nodes.push({
      id,
      title: place?.title ?? feature?.title ?? id,
      status: featureStatusOf(own, fromMain),
      flow: feature?.flow ?? id,
      spec: fromMain ?? planned,
      onMain: Boolean(fromMain),
      parent: place?.parent !== undefined ? place.parent : (feature?.parent ?? null),
      sessions: own,
      preview,
      updatedAt: Math.max(0, ...own.map((s) => s.updatedAt)),
    });
  }
  return nodes;
}

export function currentSession(feature: FeatureNode, selected: string | null = null): SessionNode | null {
  const chosen = selected ? feature.sessions.find((s) => s.id === selected) : undefined;
  if (chosen) return chosen;
  return [...feature.sessions].reverse().find((s) => s.state !== "dropped") ?? feature.sessions.at(-1) ?? null;
}

export interface TreeNode {
  readonly feature: FeatureNode;
  readonly session: SessionNode;
  readonly group: SessionGroup;
  readonly children: readonly TreeNode[];
}

const TREE_ORDER: Readonly<Record<SessionGroup, number>> = { working: 0, "needs-you": 1, live: 2, stopped: 3 };

function rankOf(node: TreeNode): number {
  return Math.min(TREE_ORDER[node.group], ...node.children.map(rankOf));
}

function latestOf(node: TreeNode): number {
  return Math.max(node.feature.updatedAt, ...node.children.map(latestOf));
}

function sortTree(nodes: readonly TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => rankOf(a) - rankOf(b) || latestOf(b) - latestOf(a) || a.feature.title.localeCompare(b.feature.title));
}

export function featureTree(features: readonly FeatureNode[]): TreeNode[] {
  const built = features.filter((f) => f.sessions.length > 0);
  const ids = new Set(built.map((f) => f.id));
  const make = (feature: FeatureNode, seen: ReadonlySet<string>): TreeNode => {
    const session = currentSession(feature) as SessionNode;
    const path = new Set([...seen, feature.id]);
    const children = built.filter((f) => f.parent === feature.id && !path.has(f.id)).map((f) => make(f, path));
    return { feature, session, group: groupOf(session.state, session.needs), children: sortTree(children) };
  };
  const roots = built.filter((f) => !f.parent || !ids.has(f.parent) || f.parent === f.id).map((f) => make(f, new Set()));
  const placed = new Set<string>();
  const mark = (node: TreeNode): void => {
    placed.add(node.feature.id);
    node.children.forEach(mark);
  };
  roots.forEach(mark);
  for (const f of built) {
    if (placed.has(f.id)) continue;
    const node = make(f, new Set());
    mark(node);
    roots.push(node);
  }
  return sortTree(roots);
}

const STATUS_ORDER: Readonly<Record<FeatureStatus, number>> = { stuck: 0, building: 1, proposed: 2, merged: 3, dropped: 4 };

export function sortFeatures(list: readonly FeatureNode[]): FeatureNode[] {
  return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export type SessionGroup = "needs-you" | "working" | "live" | "stopped";

export const GROUPS: readonly SessionGroup[] = ["needs-you", "working", "live", "stopped"];

export function groupOf(state: SessionState, needs: readonly string[] = []): SessionGroup {
  if (state === "stuck" || (needs.length > 0 && isActive(state))) return "needs-you";
  if (state === "merged") return "live";
  if (state === "dropped") return "stopped";
  return "working";
}

export function waitsForKey(node: Pick<SessionNode, "state" | "needs">): boolean {
  return node.needs.length > 0 && isActive(node.state);
}

export function groupSessions(sessions: readonly SessionNode[]): Record<SessionGroup, SessionNode[]> {
  const groups: Record<SessionGroup, SessionNode[]> = { "needs-you": [], working: [], live: [], stopped: [] };
  for (const s of sessions) groups[groupOf(s.state, s.needs)].push(s);
  for (const list of Object.values(groups)) list.sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
}

export interface Relations {
  readonly parent: SessionNode | null;
  readonly children: readonly SessionNode[];
  readonly attempts: readonly SessionNode[];
  readonly chain: readonly SessionNode[];
}

export function relationsOf(node: SessionNode, sessions: readonly SessionNode[]): Relations {
  const parent = node.parent ? (sessions.find((s) => s.id === node.parent) ?? null) : null;
  const children = sessions.filter((s) => s.parent === node.id);
  const group = node.attempt && node.attempt.of > 1 ? node.attempt.group : null;
  const attempts = group ? sessions.filter((s) => s.attempt?.group === group).sort((a, b) => (a.attempt?.index ?? 0) - (b.attempt?.index ?? 0)) : [];
  const chain = sessions.filter((s) => s.featureId === node.featureId).sort((a, b) => a.createdAt - b.createdAt);
  return { parent, children, attempts, chain };
}

export function sessionLabel(node: SessionNode): string {
  return node.attempt && node.attempt.of > 1 ? `${node.id} · try ${node.attempt.index} of ${node.attempt.of}` : node.id;
}

export function isChore(node: SessionNode): boolean {
  return node.record?.kind === "chore" || node.live?.kind === "chore";
}

export function isHotfix(node: SessionNode): boolean {
  return node.record?.hotfix === true || node.live?.hotfix === true;
}

export function heldBy(node: SessionNode): string | null {
  if (node.state !== "gating") return null;
  return node.live ? node.live.heldBy : (node.record?.heldBy ?? null);
}
