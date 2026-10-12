import type { FeatureSpec, SessionRecord, SessionState } from "@kargah/core";
import { isActive, type ProjectLive, type SessionLive } from "./events";

export type FeatureStatus = "building" | "stuck" | "merged" | "proposed" | "dropped";

export interface SessionNode {
  readonly id: string;
  readonly featureId: string;
  readonly state: SessionState;
  readonly attempt: { readonly index: number; readonly of: number } | null;
  readonly createdAt: number;
  readonly updatedAt: number;
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
  readonly sessions: readonly SessionNode[];
  readonly preview: { readonly url: string; readonly commitId: string; readonly sessionId: string } | null;
  readonly updatedAt: number;
}

export interface FeatureGroup {
  readonly name: string;
  readonly features: readonly FeatureNode[];
}

export function sessionNodes(live: ProjectLive, records: readonly SessionRecord[]): SessionNode[] {
  const byId = new Map<string, SessionNode>();
  for (const record of records) {
    const l = live.sessions[record.id];
    byId.set(record.id, { id: record.id, featureId: record.featureId, state: l?.state ?? record.machine.state, attempt: record.attempt, createdAt: record.createdAt, updatedAt: Math.max(record.updatedAt, l?.updatedAt ?? 0), live: l, record });
  }
  for (const id of live.order) {
    const l = live.sessions[id];
    if (!l || byId.has(id)) continue;
    byId.set(id, { id, featureId: l.featureId, state: l.state, attempt: l.attempt, createdAt: l.createdAt, updatedAt: l.updatedAt, live: l, record: undefined });
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function statusOf(sessions: readonly SessionNode[], spec: FeatureSpec | null): FeatureStatus {
  if (sessions.some((s) => isActive(s.state))) return "building";
  const latest = [...sessions].reverse().find((s) => s.state !== "dropped");
  if (latest?.state === "stuck") return "stuck";
  if (spec?.status === "merged" || sessions.some((s) => s.state === "merged")) return "merged";
  if (spec) return spec.status === "stuck" ? "stuck" : spec.status === "building" ? "proposed" : spec.status;
  return sessions.length ? "dropped" : "proposed";
}

export function featureNodes(live: ProjectLive, records: readonly SessionRecord[], spec: readonly FeatureSpec[]): FeatureNode[] {
  const sessions = sessionNodes(live, records);
  const ids = new Set<string>([...spec.map((f) => f.id), ...sessions.map((s) => s.featureId)]);
  const nodes: FeatureNode[] = [];
  for (const id of ids) {
    const own = sessions.filter((s) => s.featureId === id);
    const fromMain = spec.find((f) => f.id === id) ?? null;
    const planned = [...own].reverse().find((s) => s.record)?.record?.plan.feature ?? null;
    const feature = fromMain ?? planned;
    const preview = live.previews[id] ?? null;
    nodes.push({
      id,
      title: feature?.title ?? id,
      status: statusOf(own, fromMain),
      flow: feature?.flow ?? id,
      spec: fromMain ?? planned,
      onMain: Boolean(fromMain),
      sessions: own,
      preview,
      updatedAt: Math.max(0, ...own.map((s) => s.updatedAt)),
    });
  }
  return nodes;
}

const STATUS_ORDER: Readonly<Record<FeatureStatus, number>> = { stuck: 0, building: 1, proposed: 2, merged: 3, dropped: 4 };

export function groupFeatures(nodes: readonly FeatureNode[]): FeatureGroup[] {
  const flows = new Map<string, FeatureNode[]>();
  for (const node of nodes) flows.set(node.flow, [...(flows.get(node.flow) ?? []), node]);
  const shared: FeatureGroup[] = [];
  const single: FeatureNode[] = [];
  for (const [flow, list] of flows) {
    if (list.length > 1) shared.push({ name: flow, features: sortFeatures(list) });
    else single.push(...list);
  }
  const groups = shared.sort((a, b) => a.name.localeCompare(b.name));
  if (single.length) groups.push({ name: groups.length ? "Other features" : "Features", features: sortFeatures(single) });
  return groups;
}

function sortFeatures(list: readonly FeatureNode[]): FeatureNode[] {
  return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function matches(node: FeatureNode, filter: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q && !node.id.includes(q) && !node.title.toLowerCase().includes(q) && !node.sessions.some((s) => s.id.includes(q))) return false;
  if (filter === "active") return node.status === "building";
  if (filter === "stuck") return node.status === "stuck";
  if (filter === "done") return node.status === "merged";
  return true;
}
