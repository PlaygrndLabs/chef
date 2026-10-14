import { z } from "zod";
import type { KeyValueStore } from "../ports/runtime.ts";
import { DEFAULT_ROUTER_CONFIG, DEFAULT_WORDING, type RouterConfig, type RoutingWording } from "../router/router.ts";
import { AgentProfile, Skill, type Profiles } from "./profile.ts";

const text = (max: number, empty: string) => z.string().trim().min(1, empty).max(max);
const model = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/, "a model id uses letters, digits and . _ : / @ -");
const share = z.number().min(0, "a threshold is between 0 and 1").max(1, "a threshold is between 0 and 1");

export const RESERVED_ROLES: readonly string[] = ["sync", "chef", "checks", "gate", "router", "person"];

export const RoleSetting = z.strictObject({
  label: text(60, "the role needs a name"),
  description: text(500, "say what the role does"),
  instructions: text(20_000, "the role needs a system prompt"),
  model: model.nullable(),
  skills: z.array(z.string()).max(30),
});

export type RoleSetting = z.infer<typeof RoleSetting>;

export const RouterSettings = z.strictObject({
  useJev: z.boolean(),
  thresholds: z.strictObject({ new_feature: share, change_feature: share, chore: share, question: share, feature: share }),
  wording: z.strictObject({
    intent: z.strictObject({ instructions: text(500, "the question needs text"), criteria: z.strictObject({ new_feature: text(300, "describe each answer"), change_feature: text(300, "describe each answer"), chore: text(300, "describe each answer"), question: text(300, "describe each answer") }) }),
    feature: z.strictObject({ instructions: text(500, "the question needs text"), none: text(300, "describe each answer") }),
    change: z.strictObject({ instructions: text(500, "the question needs text"), criteria: z.strictObject({ bug: text(300, "describe each answer"), extend: text(300, "describe each answer"), refactor: text(300, "describe each answer") }) }),
  }),
});

export type RouterSettings = z.infer<typeof RouterSettings>;

export const AgentConfig = z.strictObject({
  roles: z.record(z.string().regex(/^[a-z][a-z-]{1,39}$/, "a role id uses lower case letters and dashes"), RoleSetting),
  skills: z.array(Skill).max(30),
  router: RouterSettings.nullable(),
});

export type AgentConfig = z.infer<typeof AgentConfig>;

export const EMPTY_AGENT_CONFIG: AgentConfig = { roles: {}, skills: [], router: null };

export const DEFAULT_ROUTER_SETTINGS: RouterSettings = {
  useJev: true,
  thresholds: { ...DEFAULT_ROUTER_CONFIG.thresholds, feature: DEFAULT_ROUTER_CONFIG.featureThreshold },
  wording: structuredClone(DEFAULT_WORDING) as RouterSettings["wording"],
};

const MAX_CONFIG_CHARS = 100_000;
const HISTORY = 30;

export function configProblems(config: AgentConfig, defaults: Profiles): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const skill of config.skills) {
    if (names.has(skill.name)) problems.push(`two skills are named ${skill.name}`);
    names.add(skill.name);
  }
  for (const [role, setting] of Object.entries(config.roles)) {
    if (RESERVED_ROLES.includes(role)) problems.push(`${role} is a name Chef uses itself; pick another role id`);
    for (const skill of setting.skills) if (!names.has(skill)) problems.push(`${setting.label} uses a skill that does not exist: ${skill}`);
    if (!defaults[role] && setting.label.trim().length === 0) problems.push(`${role} needs a name`);
  }
  if (JSON.stringify(config).length > MAX_CONFIG_CHARS) problems.push(`prompts and skills together are over ${MAX_CONFIG_CHARS} characters; shorten some of them`);
  return problems;
}

export function parseAgentConfig(body: unknown, defaults: Profiles): { ok: true; config: AgentConfig } | { ok: false; error: string } {
  const parsed = AgentConfig.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; ") };
  const problems = configProblems(parsed.data, defaults);
  return problems.length ? { ok: false, error: problems.join("; ") } : { ok: true, config: parsed.data };
}

export function mergeAgentConfig(global: AgentConfig, project: AgentConfig): AgentConfig {
  const own = new Set(project.skills.map((skill) => skill.name));
  return {
    roles: { ...global.roles, ...project.roles },
    skills: [...global.skills.filter((skill) => !own.has(skill.name)), ...project.skills],
    router: project.router ?? global.router,
  };
}

export function parseProjectAgentConfig(body: unknown, defaults: Profiles, global: AgentConfig): { ok: true; config: AgentConfig } | { ok: false; error: string } {
  const parsed = AgentConfig.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; ") };
  const problems = configProblems(mergeAgentConfig(global, parsed.data), defaults);
  return problems.length ? { ok: false, error: problems.join("; ") } : { ok: true, config: parsed.data };
}

const BUILDER_SCOPE = ["features/{feature}/**", "!features/{feature}/**/*.test.ts", "!features/{feature}/flow.ts", "src/registry.gen.ts"];

export function applyAgentConfig(defaults: Profiles, config: AgentConfig): Profiles {
  const library = new Map(config.skills.map((skill) => [skill.name, skill]));
  const everyone = config.skills.filter((skill) => skill.everyone);
  const withShared = (profile: AgentProfile, own: readonly Skill[]): AgentProfile => (profile.runs === "rules" || everyone.length === 0 ? { ...profile, skills: [...own] } : { ...profile, skills: [...everyone, ...own.filter((skill) => !skill.everyone)] });
  const out: Record<string, AgentProfile> = {};
  for (const [role, profile] of Object.entries(defaults)) out[role] = everyone.length && profile.runs !== "rules" ? withShared(profile, profile.skills) : profile;
  for (const [role, setting] of Object.entries(config.roles)) {
    if (RESERVED_ROLES.includes(role)) continue;
    const base = defaults[role];
    const own = setting.skills.map((name) => library.get(name)).filter((skill): skill is Skill => Boolean(skill));
    const shared = { label: setting.label, description: setting.description, instructions: setting.instructions };
    const profile = base
      ? { ...base, ...shared, model: setting.model ?? base.model }
      : AgentProfile.parse({ role, ...shared, model: setting.model ?? "coder-default", runs: "agent", plannable: true, sharedAccess: true, writeScope: BUILDER_SCOPE });
    out[role] = withShared(profile, own);
  }
  return out;
}

export function routerConfigOf(settings: RouterSettings | null): RouterConfig {
  const s = settings ?? DEFAULT_ROUTER_SETTINGS;
  const { feature, ...thresholds } = s.thresholds;
  return { thresholds, featureThreshold: feature, useClassifier: s.useJev, wording: s.wording as RoutingWording };
}

export interface AgentVersion {
  readonly version: number;
  readonly at: number;
  readonly summary: string;
}

export interface StoredAgents extends AgentVersion {
  readonly config: AgentConfig;
}

export const DEFAULT_STORED_AGENTS: StoredAgents = { version: 0, at: 0, summary: "Chef defaults", config: EMPTY_AGENT_CONFIG };


export type SaveResult = { readonly ok: true; readonly stored: StoredAgents } | { readonly ok: false; readonly error: string; readonly status: 404 | 409 };

export interface AgentStore {
  current(): Promise<StoredAgents>;
  history(): Promise<AgentVersion[]>;
  save(config: AgentConfig, summary: string, expected: number | null): Promise<SaveResult>;
  restore(version: number): Promise<SaveResult>;
}

export class AgentSettings implements AgentStore {
  private readonly key: string;
  private readonly versions: string;

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
    prefix = "agents/",
  ) {
    this.key = `${prefix}current`;
    this.versions = `${prefix}version/`;
  }

  async current(): Promise<StoredAgents> {
    return (await this.store.get<StoredAgents>(this.key)) ?? DEFAULT_STORED_AGENTS;
  }

  async history(): Promise<AgentVersion[]> {
    const versions = [...(await this.store.list<StoredAgents>(this.versions)).values()];
    return versions.map(({ version, at, summary }) => ({ version, at, summary })).sort((a, b) => b.version - a.version);
  }

  async save(config: AgentConfig, summary: string, expected: number | null): Promise<SaveResult> {
    const current = await this.current();
    if (expected !== null && expected !== current.version) return { ok: false, status: 409, error: `a newer version (${current.version}) was saved meanwhile; reload and try again` };
    const next: StoredAgents = { version: current.version + 1, at: this.now(), summary: summary.trim().slice(0, 200) || "Changed agents", config };
    await this.store.put(`${this.versions}${String(next.version).padStart(6, "0")}`, next);
    await this.store.put(this.key, next);
    await this.prune();
    return { ok: true, stored: next };
  }

  async restore(version: number): Promise<SaveResult> {
    const target = version === 0 ? { config: EMPTY_AGENT_CONFIG } : await this.store.get<StoredAgents>(`${this.versions}${String(version).padStart(6, "0")}`);
    if (!target) return { ok: false, status: 404, error: `version ${version} is no longer kept` };
    return this.save(target.config, version === 0 ? "Back to Chef defaults" : `Restored version ${version}`, null);
  }

  private async prune(): Promise<void> {
    const keys = [...(await this.store.list<StoredAgents>(this.versions)).keys()].sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - HISTORY))) await this.store.delete(key);
  }
}

export interface RoleView {
  readonly role: string;
  readonly label: string;
  readonly description: string;
  readonly instructions: string;
  readonly model: string | null;
  readonly defaultModel: string;
  readonly runs: AgentProfile["runs"];
  readonly plannable: boolean;
  readonly writeScope: readonly string[];
  readonly tools: readonly string[] | null;
  readonly skills: readonly string[];
  readonly custom: boolean;
  readonly edited: boolean;
  readonly defaults: { readonly label: string; readonly description: string; readonly instructions: string; readonly model: string } | null;
}

export interface AgentScope {
  readonly project: string;
  readonly roles: readonly string[];
  readonly skills: readonly string[];
  readonly router: boolean;
  readonly shared: { readonly version: number; readonly roles: readonly string[]; readonly skills: readonly string[]; readonly router: boolean };
}

export interface AgentsView extends AgentVersion {
  readonly roles: readonly RoleView[];
  readonly skills: readonly Skill[];
  readonly router: RouterSettings;
  readonly routerDefaults: RouterSettings;
  readonly routerEdited: boolean;
  readonly jev: boolean;
  readonly history: readonly AgentVersion[];
  readonly scope?: AgentScope;
}

const ORDER = ["planner", "test", "backend", "frontend", "designer", "chore", "reviewer", "conflict-resolver", "gardener"];

export function resolveModel(model: string, models: Readonly<Record<"planner" | "reviewer" | "coder", string>>): string {
  if (model === "coder-default") return models.coder;
  if (model === "planner-default") return models.planner;
  if (model === "reviewer-default") return models.reviewer;
  return model;
}

export function agentsView(defaults: Profiles, stored: StoredAgents, history: readonly AgentVersion[], models: Readonly<Record<"planner" | "reviewer" | "coder", string>>, jev: boolean): AgentsView {
  const effective = applyAgentConfig(defaults, stored.config);
  const rank = (role: string) => (ORDER.includes(role) ? ORDER.indexOf(role) : ORDER.length);
  const roles = Object.values(effective)
    .sort((a, b) => rank(a.role) - rank(b.role) || a.role.localeCompare(b.role))
    .map((profile): RoleView => {
      const base = defaults[profile.role] ?? null;
      const setting = stored.config.roles[profile.role] ?? null;
      return {
        role: profile.role,
        label: profile.label ?? profile.role,
        description: profile.description,
        instructions: profile.instructions,
        model: setting?.model ?? null,
        defaultModel: resolveModel(base?.model ?? "coder-default", models),
        runs: profile.runs,
        plannable: profile.plannable,
        writeScope: profile.writeScope,
        tools: profile.tools,
        skills: (setting?.skills ?? []).filter((name) => stored.config.skills.some((skill) => skill.name === name && !skill.everyone)),
        custom: base === null,
        edited: setting !== null,
        defaults: base ? { label: base.label ?? base.role, description: base.description, instructions: base.instructions, model: resolveModel(base.model, models) } : null,
      };
    });
  return {
    version: stored.version,
    at: stored.at,
    summary: stored.summary,
    roles,
    skills: stored.config.skills,
    router: stored.config.router ?? DEFAULT_ROUTER_SETTINGS,
    routerDefaults: DEFAULT_ROUTER_SETTINGS,
    routerEdited: stored.config.router !== null,
    jev,
    history,
  };
}

export function projectAgentsView(project: string, defaults: Profiles, shared: StoredAgents, own: StoredAgents, history: readonly AgentVersion[], models: Readonly<Record<"planner" | "reviewer" | "coder", string>>, jev: boolean): AgentsView {
  const view = agentsView(defaults, { ...own, config: mergeAgentConfig(shared.config, own.config) }, history, models, jev);
  return {
    ...view,
    scope: {
      project,
      roles: Object.keys(own.config.roles),
      skills: own.config.skills.map((skill) => skill.name),
      router: own.config.router !== null,
      shared: { version: shared.version, roles: Object.keys(shared.config.roles), skills: shared.config.skills.map((skill) => skill.name), router: shared.config.router !== null },
    },
  };
}
