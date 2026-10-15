import type { FeatureLayout, FeatureMap, FeatureSpec, MapFeature, SessionRecord, SessionState } from "@chef/core";
import { isActive, type AppView, type ProjectLive, type SessionLive } from "./events";

export type FeatureStatus = "building" | "ready" | "stuck" | "merged" | "done" | "proposed" | "dropped";

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
  readonly budget: string | null;
  readonly ready: string | null;
  readonly live: SessionLive | undefined;
  readonly record: SessionRecord | undefined;
  readonly into: string | null;
}

export type MapMark = "current" | "wish" | "working";

export interface FeatureNode {
  readonly id: string;
  readonly map: MapFeature | null;
  readonly mark: MapMark;
  readonly title: string;
  readonly status: FeatureStatus;
  readonly flow: string;
  readonly spec: FeatureSpec | null;
  readonly onMain: boolean;
  readonly parent: string | null;
  readonly sessions: readonly SessionNode[];
  readonly app: (AppView & { readonly sessionId: string }) | null;
  readonly updatedAt: number;
}

function waitingIn(record: SessionRecord, records: ReadonlyMap<string, SessionRecord>, state: (id: string) => SessionState | undefined): string | null {
  let into = record.merge?.into;
  for (let depth = 0; into && depth < 20; depth++) {
    const upstream = records.get(into);
    if (!upstream) return null;
    if (state(into) !== "merged") return upstream.featureId;
    into = upstream.merge?.into;
  }
  return null;
}

export function sessionNodes(live: ProjectLive, records: readonly SessionRecord[]): SessionNode[] {
  const byId = new Map<string, SessionNode>();
  const known = new Map(records.map((r) => [r.id, r]));
  const stateOf = (id: string) => live.sessions[id]?.state ?? known.get(id)?.machine.state;
  for (const record of records) {
    const l = live.sessions[record.id];
    byId.set(record.id, { id: record.id, featureId: record.featureId, state: l?.state ?? record.machine.state, attempt: record.attempt, parent: record.parent, createdAt: record.createdAt, updatedAt: Math.max(record.updatedAt, l?.updatedAt ?? 0), needs: l && l.updatedAt >= record.updatedAt ? l.needs : (record.needs ?? []), budget: l && l.updatedAt >= record.updatedAt ? l.budget : (record.overBudget ?? null), ready: l && l.updatedAt >= record.updatedAt ? l.ready : record.ready && !record.ready.approved ? record.ready.commitId : null, live: l, record, into: waitingIn(record, known, stateOf) });
  }
  for (const id of live.order) {
    const l = live.sessions[id];
    if (!l || byId.has(id)) continue;
    byId.set(id, { id, featureId: l.featureId, state: l.state, attempt: l.attempt, parent: l.parent, createdAt: l.createdAt, updatedAt: l.updatedAt, needs: l.needs, budget: l.budget, ready: l.ready, live: l, record: undefined, into: null });
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function featureStatusOf(sessions: readonly SessionNode[], spec: FeatureSpec | null, map: MapFeature | null = null): FeatureStatus {
  if (!sessions.length && map) return map.state === "current" ? "merged" : "proposed";
  if (sessions.some((s) => isActive(s.state) && !waitsForMerge(s))) return "building";
  if (sessions.some((s) => waitsForMerge(s))) return "ready";
  const latest = [...sessions].reverse().find((s) => s.state !== "dropped");
  if (latest?.state === "stuck") return "stuck";
  if (sessions.some((s) => s.state === "merged" && !s.into)) return "merged";
  if (sessions.some((s) => s.state === "merged" && s.into)) return "done";
  if (spec?.status === "merged") return "merged";
  if (spec) return spec.status === "stuck" ? "stuck" : spec.status === "building" ? "proposed" : spec.status;
  return sessions.length ? "dropped" : "proposed";
}

function markOf(status: FeatureStatus, sessions: readonly SessionNode[], map: MapFeature | null, onMain: boolean): MapMark {
  if (sessions.some((s) => isActive(s.state) && !waitsForMerge(s) && !waitsForKey(s) && !waitsForBudget(s))) return "working";
  if (map) return map.state;
  return onMain && status === "merged" ? "current" : sessions.some((s) => s.state === "merged") ? "current" : "wish";
}

export function featureNodes(live: ProjectLive, records: readonly SessionRecord[], spec: readonly FeatureSpec[], layout: FeatureLayout = {}, map: FeatureMap | null = null): FeatureNode[] {
  const sessions = sessionNodes(live, records);
  const mapped = new Map((map?.features ?? []).map((f) => [f.name, f]));
  const ids = new Set<string>([...mapped.keys(), ...spec.map((f) => f.id), ...sessions.map((s) => s.featureId)]);
  const nodes: FeatureNode[] = [];
  for (const id of ids) {
    const place = layout[id];
    const removedAt = place?.removedAt;
    const own = sessions.filter((s) => s.featureId === id && (removedAt === undefined || s.createdAt > removedAt));
    const inMap = mapped.get(id) ?? null;
    if (removedAt !== undefined && own.length === 0 && !inMap) continue;
    const fromMain = spec.find((f) => f.id === id) ?? null;
    const planned = [...own].reverse().find((s) => s.record)?.record?.plan.feature ?? null;
    const feature = fromMain ?? planned;
    const app = live.apps[id] ?? null;
    const status = featureStatusOf(own, fromMain, inMap);
    const mapParent = inMap ? (inMap.parent ? (inMap.parent.split("/").at(-1) ?? null) : null) : undefined;
    nodes.push({
      id,
      map: inMap,
      mark: markOf(status, own, inMap, Boolean(fromMain)),
      title: inMap ? inMap.title : (place?.title ?? feature?.title ?? id),
      status,
      flow: feature?.flow ?? id,
      spec: fromMain ?? planned,
      onMain: Boolean(fromMain),
      parent: mapParent !== undefined ? mapParent : place?.parent !== undefined ? place.parent : (feature?.parent ?? null),
      sessions: own,
      app,
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
  readonly session: SessionNode | null;
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
  const built = features.filter((f) => f.sessions.length > 0 || f.map !== null);
  const ids = new Set(built.map((f) => f.id));
  const make = (feature: FeatureNode, seen: ReadonlySet<string>): TreeNode => {
    const session = currentSession(feature);
    const path = new Set([...seen, feature.id]);
    const children = built.filter((f) => f.parent === feature.id && !path.has(f.id)).map((f) => make(f, path));
    const group: SessionGroup = session ? groupOf(session.state, session.needs, session.budget, session.ready) : feature.mark === "current" ? "live" : "stopped";
    return { feature, session, group, children: sortTree(children) };
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

const STATUS_ORDER: Readonly<Record<FeatureStatus, number>> = { stuck: 0, ready: 1, building: 2, proposed: 3, done: 4, merged: 5, dropped: 6 };

export function sortFeatures(list: readonly FeatureNode[]): FeatureNode[] {
  return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export type SessionGroup = "needs-you" | "working" | "live" | "stopped";

export const GROUPS: readonly SessionGroup[] = ["needs-you", "working", "live", "stopped"];

export function groupOf(state: SessionState, needs: readonly string[] = [], budget: string | null = null, ready: string | null = null): SessionGroup {
  if (state === "stuck" || ((needs.length > 0 || budget !== null || ready !== null) && isActive(state))) return "needs-you";
  if (state === "merged") return "live";
  if (state === "dropped") return "stopped";
  return "working";
}

export function waitsForMerge(node: Pick<SessionNode, "state" | "ready">): string | null {
  return node.state === "gating" ? node.ready : null;
}

export function nodeStatus(node: Pick<SessionNode, "state" | "ready">): FeatureStatus {
  return waitsForMerge(node) ? "ready" : statusOf(node.state);
}

export function waitsForKey(node: Pick<SessionNode, "state" | "needs">): boolean {
  return node.needs.length > 0 && isActive(node.state);
}

export function waitsForBudget(node: Pick<SessionNode, "state" | "budget">): string | null {
  return node.budget !== null && isActive(node.state) ? node.budget : null;
}

export function groupSessions(sessions: readonly SessionNode[]): Record<SessionGroup, SessionNode[]> {
  const groups: Record<SessionGroup, SessionNode[]> = { "needs-you": [], working: [], live: [], stopped: [] };
  for (const s of sessions) groups[groupOf(s.state, s.needs, s.budget, s.ready)].push(s);
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
