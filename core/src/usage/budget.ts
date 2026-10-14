export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
}

export interface SpendGate {
  blocked(by: string | null): Promise<string | null>;
  record(by: string | null, model: string, usage: TokenUsage): Promise<void>;
  scope<T>(by: string | null, work: () => Promise<T>): Promise<T>;
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
}

export const NO_CAPS: Caps = { org: null, projects: {}, members: {} };

interface Price {
  readonly input: number;
  readonly output: number;
}

const PRICES: readonly (readonly [RegExp, Price])[] = [
  [/haiku/i, { input: 1, output: 5 }],
  [/sonnet/i, { input: 2, output: 10 }],
  [/opus/i, { input: 4, output: 20 }],
];

const FALLBACK: Price = { input: 4, output: 20 };

export function priceOf(model: string): Price {
  return PRICES.find(([pattern]) => pattern.test(model))?.[1] ?? FALLBACK;
}

export function costMicros(model: string, usage: TokenUsage): number {
  const price = priceOf(model);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  return Math.round((usage.inputTokens - cached) * price.input + cached * price.input * 0.1 + usage.outputTokens * price.output);
}

export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function emptyLedger(month: string): Ledger {
  return { month, org: 0, projects: {}, members: {} };
}

export function addSpend(ledger: Ledger, month: string, project: string, by: string | null, micros: number): Ledger {
  const base = ledger.month === month ? ledger : emptyLedger(month);
  return {
    month,
    org: base.org + micros,
    projects: { ...base.projects, [project]: (base.projects[project] ?? 0) + micros },
    members: by ? { ...base.members, [by]: (base.members[by] ?? 0) + micros } : base.members,
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
