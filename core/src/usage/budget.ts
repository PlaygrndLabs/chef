import type { SessionState } from "../session/machine.ts";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly audioInputTokens?: number;
  readonly audioOutputTokens?: number;
}

export type SpendGroup = "models" | "cloudflare";

export const PARTS = {
  model: { label: "Writing code", group: "models" },
  router: { label: "Routing", group: "models" },
  voice: { label: "Live talk", group: "models" },
  sandbox: { label: "Sandboxes on Cloudflare", group: "cloudflare" },
} as const satisfies Record<string, { readonly label: string; readonly group: SpendGroup }>;

export type SpendPart = keyof typeof PARTS;

export const SPEND_PARTS = Object.keys(PARTS) as readonly SpendPart[];

export const SPEND_GROUPS: readonly SpendGroup[] = ["models", "cloudflare"];

export type Spend = Readonly<Partial<Record<SpendPart, number>>>;

export function addTo(spend: Spend, part: SpendPart, micros: number): Spend {
  return { ...spend, [part]: (spend[part] ?? 0) + micros };
}

export function sumOf(spend: Spend, group?: SpendGroup): number {
  return SPEND_PARTS.reduce((sum, part) => (group === undefined || PARTS[part].group === group ? sum + (spend[part] ?? 0) : sum), 0);
}

export function addAll(a: Spend, b: Spend): Spend {
  return SPEND_PARTS.reduce((sum, part) => (b[part] ? addTo(sum, part, b[part]) : sum), a);
}

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

export interface MonthSpend {
  readonly month: string;
  readonly projects: Readonly<Record<string, Spend>>;
  readonly members: Readonly<Record<string, Spend>>;
}

export interface Ledger {
  readonly month: string;
  readonly org: number;
  readonly projects: Readonly<Record<string, number>>;
  readonly members: Readonly<Record<string, number>>;
  readonly parts: Spend;
  readonly projectParts: Readonly<Record<string, Spend>>;
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

export interface BuildCost {
  readonly months: Readonly<Record<string, Spend>>;
  readonly sandboxSeconds: number;
}

export const NO_COST: BuildCost = { months: {}, sandboxSeconds: 0 };

export const PROJECT_COST = "project";

export function addCost(cost: BuildCost, month: string, part: SpendPart, micros: number, seconds = 0): BuildCost {
  return { months: { ...cost.months, [month]: addTo(cost.months[month] ?? {}, part, micros) }, sandboxSeconds: cost.sandboxSeconds + seconds };
}

export function lifetime(cost: BuildCost): Spend {
  return Object.values(cost.months).reduce<Spend>(addAll, {});
}

export interface BuildUsage {
  readonly id: string;
  readonly feature: string;
  readonly title: string;
  readonly state: SessionState;
  readonly createdAt: number;
  readonly month: Spend;
  readonly total: Spend;
  readonly sandboxSeconds: number;
}

export interface ProjectUsage {
  readonly month: string;
  readonly spent: number;
  readonly cap: number | null;
  readonly parts: Spend;
  readonly builds: readonly BuildUsage[];
  readonly main: Spend;
  readonly mainSeconds: number;
  readonly outside: Spend;
}

export function projectUsage(input: { readonly project: string; readonly caps: Caps; readonly ledger: Ledger; readonly sessions: readonly { readonly id: string; readonly featureId: string; readonly createdAt: number; readonly plan: { readonly feature: { readonly title: string } }; readonly machine: { readonly state: SessionState } }[]; readonly costs: ReadonlyMap<string, BuildCost>; readonly main: string }): ProjectUsage {
  const { project, caps, ledger, costs } = input;
  const month = (key: string) => costs.get(key)?.months[ledger.month] ?? {};
  return {
    month: ledger.month,
    spent: ledger.projects[project] ?? 0,
    cap: caps.projects[project] ?? null,
    parts: ledger.projectParts[project] ?? {},
    builds: [...input.sessions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => {
        const cost = costs.get(s.id) ?? NO_COST;
        return { id: s.id, feature: s.featureId, title: s.plan.feature.title, state: s.machine.state, createdAt: s.createdAt, month: month(s.id), total: lifetime(cost), sandboxSeconds: cost.sandboxSeconds };
      }),
    main: month(input.main),
    mainSeconds: costs.get(input.main)?.sandboxSeconds ?? 0,
    outside: month(PROJECT_COST),
  };
}

export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function emptyMonth(month: string): MonthSpend {
  return { month, projects: {}, members: {} };
}

export function addSpend(spend: MonthSpend, project: string, by: string | null, micros: number, part: SpendPart = "model"): MonthSpend {
  return {
    month: spend.month,
    projects: { ...spend.projects, [project]: addTo(spend.projects[project] ?? {}, part, micros) },
    members: by ? { ...spend.members, [by]: addTo(spend.members[by] ?? {}, part, micros) } : spend.members,
  };
}

export function ledgerOf(spend: MonthSpend): Ledger {
  const totals = (of: Readonly<Record<string, Spend>>) => Object.fromEntries(Object.entries(of).map(([name, s]) => [name, sumOf(s)]));
  const parts = Object.values(spend.projects).reduce<Spend>(addAll, {});
  return { month: spend.month, org: sumOf(parts), projects: totals(spend.projects), members: totals(spend.members), parts, projectParts: spend.projects };
}

export function emptyLedger(month: string): Ledger {
  return ledgerOf(emptyMonth(month));
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
