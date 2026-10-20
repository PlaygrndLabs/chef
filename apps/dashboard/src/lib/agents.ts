import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { AgentConfig, AgentsView, RoleSetting, RoleView, SessionState } from "@chef/core";
import { agentsApi } from "./api";
import { isActive } from "./events";
import { isChore, type SessionNode } from "./model";
import { stoppedAt } from "./progress";

const BUILT_IN: Readonly<Record<string, string>> = {
  planner: "Planner",
  test: "Test writer",
  backend: "Backend builder",
  frontend: "Frontend builder",
  designer: "Designer",
  reviewer: "Reviewer",
  "conflict-resolver": "Conflict fixer",
  gardener: "Gardener",
};

const cached = new Map<string, AgentsView>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function keyOf(project: string | null): string {
  return project ?? "";
}

export function setAgents(view: AgentsView): void {
  cached.set(keyOf(view.scope?.project ?? null), view);
  if (!view.scope) for (const key of [...cached.keys()]) if (key) void reloadAgents(key);
  for (const listener of listeners) listener();
}

export function reloadAgents(project: string | null): Promise<void> {
  const key = keyOf(project);
  const running = loading.get(key);
  if (running) return running;
  const next = agentsApi(project)
    .get()
    .then(setAgents, () => undefined)
    .finally(() => loading.delete(key));
  loading.set(key, next);
  return next;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgents(project: string | null): AgentsView | null {
  const key = keyOf(project);
  const view = useSyncExternalStore(subscribe, () => cached.get(key) ?? null);
  useEffect(() => {
    if (!cached.has(key)) void reloadAgents(project);
  }, [key]);
  return view;
}

export function ownRole(view: AgentsView, role: string): boolean {
  return view.scope ? view.scope.roles.includes(role) : (view.roles.find((r) => r.role === role)?.edited ?? false);
}

export function ownSkill(view: AgentsView, name: string): boolean {
  return view.scope ? view.scope.skills.includes(name) : view.skills.some((s) => s.name === name);
}

export function configOf(view: AgentsView): AgentConfig {
  const roles: Record<string, RoleSetting> = {};
  for (const r of view.roles) if (ownRole(view, r.role)) roles[r.role] = settingOf(r);
  const own = view.scope ? view.scope.router : view.routerEdited;
  return { roles, skills: view.skills.filter((s) => ownSkill(view, s.name)), router: own ? view.router : null };
}

export function settingOf(r: RoleView): RoleSetting {
  return { label: r.label, description: r.description, instructions: r.instructions, model: r.model, skills: [...r.skills] };
}

export async function saveAgents(view: AgentsView, config: AgentConfig, summary: string): Promise<boolean> {
  try {
    const next = await agentsApi(view.scope?.project ?? null).save(config, summary, view.version);
    setAgents(next);
    toast.success("Saved", { description: `Version ${next.version}. Builds use it from their next step.` });
    return true;
  } catch (error) {
    toast.error("Could not save", { description: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export function roleLabel(role: string, view: AgentsView | null): string {
  return view?.roles.find((r) => r.role === role)?.label ?? BUILT_IN[role] ?? role;
}

export function modelLabel(role: string, model: string | null, view: AgentsView | null): string | null {
  if (!model || !model.endsWith("-default")) return model;
  const r = view?.roles.find((v) => v.role === role);
  return r ? (r.model ?? r.defaultModel) : null;
}

export type MemberState = "done" | "working" | "next" | "stopped";

export interface Member {
  readonly role: string;
  readonly state: MemberState;
  readonly model: string | null;
  readonly branch: string | null;
}

const ROLE_STAGE: Readonly<Record<string, number>> = { planner: 0, test: 1, reviewer: 3 };
const STATE_STAGE: Readonly<Record<SessionState, number>> = { queued: -1, planning: 0, testing: 1, coding: 2, reviewing: 3, gating: 4, merged: 5, stuck: -1, dropped: -1 };
const HIDDEN = new Set(["sync", "gardener", "chef"]);

function stageOf(role: string): number {
  return ROLE_STAGE[role] ?? 2;
}

export function teamOf(node: SessionNode): Member[] {
  const roles: string[] = isChore(node) ? [] : ["planner"];
  const add = (role: string) => {
    if (!HIDDEN.has(role) && !roles.includes(role)) roles.push(role);
  };
  for (const item of node.record?.plan.items ?? []) add(item.role);
  for (const agent of node.live?.agents ?? []) add(agent.role);
  for (const commit of node.live?.commits ?? []) add(commit.role);
  if (!node.record?.verdict?.skipped) add("reviewer");
  roles.sort((a, b) => stageOf(a) - stageOf(b));
  const seen = new Set([...(node.live?.agents ?? []).map((a) => a.role), ...(node.live?.commits ?? []).map((c) => c.role)]);
  if (node.live?.verdict || node.record?.verdict) seen.add("reviewer");
  const halted = node.state === "stuck" || node.state === "dropped";
  const at = halted ? STATE_STAGE[stoppedAt(node.live?.timeline ?? [])] : STATE_STAGE[node.state];
  const current = at === STATE_STAGE.gating || !(isActive(node.state) || halted) ? null : (node.live?.agent?.role ?? null);
  const modelOf = (role: string) => [...(node.live?.agents ?? [])].reverse().find((a) => a.role === role)?.model ?? null;
  const lanes = node.live?.lanes ?? [];
  const inLanes = at === STATE_STAGE.coding && lanes.length > 0;
  return roles.map((role): Member => {
    const model = modelOf(role);
    const lane = lanes.find((l) => l.role === role);
    const branch = lane?.branch ?? null;
    if (node.state === "merged") return { role, state: "done", model, branch };
    if (inLanes && lane) return { role, state: lane.status === "working" ? (halted ? "stopped" : "working") : lane.status === "waiting" || lane.status === "rejected" ? "next" : "done", model, branch };
    if (role === current && !(inLanes && lanes.some((l) => l.role === current))) return { role, state: halted ? "stopped" : "working", model, branch };
    if (seen.has(role) || at > stageOf(role)) return { role, state: "done", model, branch };
    return { role, state: "next", model, branch };
  });
}

export function workingRole(node: SessionNode): string | null {
  if (!isActive(node.state) || node.state === "gating" || node.state === "queued") return null;
  return node.live?.agent?.role ?? (node.state === "planning" ? "planner" : node.state === "testing" ? "test" : node.state === "reviewing" ? "reviewer" : null);
}

export interface LaneSummary {
  readonly branch: string;
  readonly status: string;
  readonly steps: { readonly done: number; readonly of: number } | null;
  readonly commits: number;
  readonly owns: readonly string[];
}

const LANE_STATUS: Readonly<Record<string, string>> = {
  waiting: "Waiting for its turn",
  working: "Working on its part",
  committed: "Saved a step on its branch",
  unchanged: "Had nothing to change",
  rejected: "A rule blocked its last change, so it tries again",
  merged: "Its branch is merged into the feature",
  conflict: "Changed the same lines as another role, so the conflict fixer merged them",
};

export function laneSummary(node: SessionNode, role: string): LaneSummary | null {
  const live = node.live?.lanes.find((l) => l.role === role);
  const record = node.record?.lanes?.find((l) => l.role === role);
  const branch = live?.branch ?? record?.branch;
  if (!branch) return null;
  const halted = node.state === "stuck" || node.state === "dropped";
  const raw = live?.status ?? (record && record.done >= record.items.length ? "merged" : "waiting");
  const status = node.state === "merged" ? "Its work was merged with the feature" : halted && raw === "working" ? "Was working when Chef stopped" : (LANE_STATUS[raw] ?? raw);
  const of = record?.items.length ?? live?.items ?? 0;
  const commits = (node.live?.commits ?? []).filter((c) => c.role === role).length || (live?.commits ?? 0);
  return { branch, status, steps: of ? { done: Math.min(record?.done ?? 0, of), of } : null, commits, owns: record?.owns ?? [] };
}
