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
  reviewer: "Reviewer",
  "conflict-resolver": "Conflict fixer",
  gardener: "Gardener",
};

let cached: AgentsView | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function setAgents(view: AgentsView): void {
  cached = view;
  for (const listener of listeners) listener();
}

export function reloadAgents(): Promise<void> {
  loading ??= agentsApi
    .get()
    .then(setAgents, () => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgents(): AgentsView | null {
  const view = useSyncExternalStore(subscribe, () => cached);
  useEffect(() => {
    if (!cached) void reloadAgents();
  }, []);
  return view;
}

export function configOf(view: AgentsView): AgentConfig {
  const roles: Record<string, RoleSetting> = {};
  for (const r of view.roles) if (r.edited) roles[r.role] = settingOf(r);
  return { roles, skills: [...view.skills], router: view.routerEdited ? view.router : null };
}

export function settingOf(r: RoleView): RoleSetting {
  return { label: r.label, description: r.description, instructions: r.instructions, model: r.model, skills: [...r.skills] };
}

export async function saveAgents(view: AgentsView, config: AgentConfig, summary: string): Promise<boolean> {
  try {
    const next = await agentsApi.save(config, summary, view.version);
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
}

const ROLE_STAGE: Readonly<Record<string, number>> = { planner: 0, test: 1, reviewer: 3 };
const STATE_STAGE: Readonly<Record<SessionState, number>> = { queued: -1, planning: 0, testing: 1, coding: 2, reviewing: 3, gating: 4, merged: 5, stuck: -1, dropped: -1 };
const HIDDEN = new Set(["sync", "gardener"]);

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
  add("reviewer");
  roles.sort((a, b) => stageOf(a) - stageOf(b));
  const seen = new Set([...(node.live?.agents ?? []).map((a) => a.role), ...(node.live?.commits ?? []).map((c) => c.role)]);
  if (node.live?.verdict || node.record?.verdict) seen.add("reviewer");
  const halted = node.state === "stuck" || node.state === "dropped";
  const at = halted ? STATE_STAGE[stoppedAt(node.live?.timeline ?? [])] : STATE_STAGE[node.state];
  const current = at === STATE_STAGE.gating || !(isActive(node.state) || halted) ? null : (node.live?.agent?.role ?? null);
  const modelOf = (role: string) => [...(node.live?.agents ?? [])].reverse().find((a) => a.role === role)?.model ?? null;
  return roles.map((role): Member => {
    const model = modelOf(role);
    if (node.state === "merged") return { role, state: "done", model };
    if (role === current) return { role, state: halted ? "stopped" : "working", model };
    if (seen.has(role) || at > stageOf(role)) return { role, state: "done", model };
    return { role, state: "next", model };
  });
}

export function workingRole(node: SessionNode): string | null {
  if (!isActive(node.state) || node.state === "gating" || node.state === "queued") return null;
  return node.live?.agent?.role ?? (node.state === "planning" ? "planner" : node.state === "testing" ? "test" : node.state === "reviewing" ? "reviewer" : null);
}
