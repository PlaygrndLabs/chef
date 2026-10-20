import type { SessionState } from "../session/machine.ts";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly audioInputTokens?: number;
  readonly audioOutputTokens?: number;
}

export const SPEND_PARTS = ["model", "router", "voice", "sandbox"] as const;

export type SpendPart = (typeof SPEND_PARTS)[number];

export interface SpendGate {
  blocked(by: string | null): Promise<string | null>;
  record(by: string | null, model: string, usage: TokenUsage, part?: SpendPart, session?: string): Promise<void>;
  scope<T>(by: string | null, work: () => Promise<T>, session?: string): Promise<T>;
}

export interface Caps {
  readonly org: number | null;
  readonly projects: Readonly<Record<string, number>>;
  readonly members: Readonly<Record<string, number>>;
}

export interface Ledger {
  readonly month: string;
  readonly org: number;
  readonly projects: Readonly<Record<string, number>>;
  readonly members: Readonly<Record<string, number>>;
  readonly parts?: Readonly<Partial<Record<SpendPart, number>>>;
  readonly projectParts?: Readonly<Record<string, Readonly<Partial<Record<SpendPart, number>>>>>;
}

export const NO_CAPS: Caps = { org: null, projects: {}, members: {} };

interface Price {
  readonly input: number;
  readonly output: number;
  readonly audioInput?: number;
  readonly audioOutput?: number;
}

const PRICES: readonly (readonly [RegExp, Price])[] = [
  [/haiku/i, { input: 1, output: 5 }],
  [/sonnet/i, { input: 2, output: 10 }],
  [/opus/i, { input: 4, output: 20 }],
  [/^jev/i, { input: 0.042, output: 0 }],
  [/realtime-mini/i, { input: 0.6, output: 2.4, audioInput: 10, audioOutput: 20 }],
  [/realtime|live/i, { input: 4, output: 16, audioInput: 32, audioOutput: 64 }],
];

const FALLBACK: Price = { input: 4, output: 20 };

export function priceOf(model: string): Price {
  return PRICES.find(([pattern]) => pattern.test(model))?.[1] ?? FALLBACK;
}

export function costMicros(model: string, usage: TokenUsage): number {
  const price = priceOf(model);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const audioIn = Math.min(usage.audioInputTokens ?? 0, usage.inputTokens - cached);
  const audioOut = Math.min(usage.audioOutputTokens ?? 0, usage.outputTokens);
  const input = (usage.inputTokens - cached - audioIn) * price.input + audioIn * (price.audioInput ?? price.input) + cached * price.input * 0.1;
  const output = (usage.outputTokens - audioOut) * price.output + audioOut * (price.audioOutput ?? price.output);
  return Math.round(input + output);
}

export const CONTAINER_RATES = { memoryGibSecond: 2.5, diskGbSecond: 0.07, vcpuSecond: 20 } as const;

export interface SandboxRun {
  readonly memoryMib: number;
  readonly diskMb: number;
  readonly seconds: number;
  readonly cpuSeconds: number;
}

export function sandboxMicros(run: SandboxRun): number {
  const seconds = Math.max(0, run.seconds);
  const memory = (run.memoryMib / 1024) * seconds * CONTAINER_RATES.memoryGibSecond;
  const disk = (run.diskMb / 1000) * seconds * CONTAINER_RATES.diskGbSecond;
  const cpu = Math.max(0, run.cpuSeconds) * CONTAINER_RATES.vcpuSecond;
  return memory + disk + cpu;
}

export interface SessionCost {
  readonly model: number;
  readonly sandbox: number;
  readonly sandboxSeconds: number;
}

export const NO_COST: SessionCost = { model: 0, sandbox: 0, sandboxSeconds: 0 };

export interface BuildUsage {
  readonly id: string;
  readonly feature: string;
  readonly title: string;
  readonly state: SessionState;
  readonly createdAt: number;
  readonly cost: SessionCost;
}

export interface ProjectUsage {
  readonly month: string;
  readonly spent: number;
  readonly cap: number | null;
  readonly parts: Readonly<Partial<Record<SpendPart, number>>>;
  readonly builds: readonly BuildUsage[];
  readonly main: SessionCost;
}

export function projectUsage(input: { readonly project: string; readonly caps: Caps; readonly ledger: Ledger; readonly sessions: readonly { readonly id: string; readonly featureId: string; readonly createdAt: number; readonly plan: { readonly feature: { readonly title: string } }; readonly machine: { readonly state: SessionState } }[]; readonly costs: ReadonlyMap<string, SessionCost>; readonly main: string }): ProjectUsage {
  const { project, caps, ledger, costs } = input;
  return {
    month: ledger.month,
    spent: ledger.projects[project] ?? 0,
    cap: caps.projects[project] ?? null,
    parts: ledger.projectParts?.[project] ?? {},
    builds: [...input.sessions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({ id: s.id, feature: s.featureId, title: s.plan.feature.title, state: s.machine.state, createdAt: s.createdAt, cost: costs.get(s.id) ?? NO_COST })),
    main: costs.get(input.main) ?? NO_COST,
  };
}

export function addCost(cost: SessionCost, part: SpendPart, micros: number, seconds = 0): SessionCost {
  return part === "sandbox" ? { ...cost, sandbox: cost.sandbox + micros, sandboxSeconds: cost.sandboxSeconds + seconds } : { ...cost, model: cost.model + micros };
}

export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function emptyLedger(month: string): Ledger {
  return { month, org: 0, projects: {}, members: {} };
}

export function addSpend(ledger: Ledger, month: string, project: string, by: string | null, micros: number, part: SpendPart = "model"): Ledger {
  const base = ledger.month === month ? ledger : emptyLedger(month);
  return {
    month,
    org: base.org + micros,
    projects: { ...base.projects, [project]: (base.projects[project] ?? 0) + micros },
    members: by ? { ...base.members, [by]: (base.members[by] ?? 0) + micros } : base.members,
    parts: { ...base.parts, [part]: (base.parts?.[part] ?? 0) + micros },
    projectParts: { ...base.projectParts, [project]: { ...base.projectParts?.[project], [part]: (base.projectParts?.[project]?.[part] ?? 0) + micros } },
  };
}

export function dollars(micros: number): string {
  const value = micros / 1_000_000;
  return `$${value >= 100 ? Math.round(value).toLocaleString("en-US") : value.toFixed(2)}`;
}

export function overCap(caps: Caps, ledger: Ledger, month: string, project: string, by: string | null): string | null {
  const spent = ledger.month === month ? ledger : emptyLedger(month);
  if (caps.org !== null && spent.org >= caps.org) return `The organization reached its monthly budget of ${dollars(caps.org)}.`;
  const projectCap = caps.projects[project];
  if (projectCap !== undefined && (spent.projects[project] ?? 0) >= projectCap) return `This project reached its monthly budget of ${dollars(projectCap)}.`;
  const memberCap = by ? caps.members[by] : undefined;
  if (by && memberCap !== undefined && (spent.members[by] ?? 0) >= memberCap) return `The person who asked for this reached their monthly budget of ${dollars(memberCap)}.`;
  return null;
}

export function readCap(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) return undefined;
  return Math.round(value * 1_000_000);
}

export function setCaps(caps: Caps, update: { readonly org?: number | null; readonly projects?: Readonly<Record<string, number | null>>; readonly members?: Readonly<Record<string, number | null>> }): Caps {
  const merge = (current: Readonly<Record<string, number>>, changes: Readonly<Record<string, number | null>> = {}) =>
    Object.fromEntries(Object.entries({ ...current, ...changes }).filter((entry): entry is [string, number] => entry[1] !== null));
  return { org: update.org === undefined ? caps.org : update.org, projects: merge(caps.projects, update.projects), members: merge(caps.members, update.members) };
}
