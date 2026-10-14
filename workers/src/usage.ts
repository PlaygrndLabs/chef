import { AsyncLocalStorage } from "node:async_hooks";
import { costMicros, readCap, type SpendGate, type TokenUsage } from "@chef/core";
import { settingsStub } from "./settings.ts";
import { USER_HEADER } from "./access.ts";

const spender = new AsyncLocalStorage<{ readonly by: string | null }>();

export function requester(request: Request): string | null {
  const by = request.headers.get(USER_HEADER);
  return by && /^usr_[A-Za-z0-9]{20}$/.test(by) ? by : null;
}

export function nextMonth(now: number): Date {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 1));
}

export function currentSpender(): string | null {
  return spender.getStore()?.by ?? null;
}

export class EngineSpend implements SpendGate {
  constructor(
    private readonly env: Env,
    private readonly project: string,
  ) {}

  blocked(by: string | null): Promise<string | null> {
    return settingsStub(this.env).spendBlocked(this.project, by, Date.now());
  }

  async record(by: string | null, model: string, usage: TokenUsage): Promise<void> {
    const micros = costMicros(model, usage);
    if (micros > 0) await settingsStub(this.env).recordSpend(this.project, by, micros, Date.now());
  }

  scope<T>(by: string | null, work: () => Promise<T>): Promise<T> {
    return spender.run({ by }, work);
  }
}

type CapUpdate = Record<string, number | null>;

function readCaps(body: unknown, key: "projects" | "members"): CapUpdate | undefined | false {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return false;
  const out: CapUpdate = {};
  for (const [name, cap] of Object.entries(value)) {
    const read = readCap(cap);
    if (read === undefined) return false;
    out[name] = read;
  }
  return out;
}

export async function usageRequest(request: Request, env: Env, changed: (project: string) => Promise<void>): Promise<Response> {
  const settings = settingsStub(env);
  if (request.method === "GET") return Response.json(await settings.spending(Date.now()));
  if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as { org?: unknown } | null;
  const org = body && "org" in body ? readCap(body.org) : undefined;
  const projects = readCaps(body, "projects");
  const members = readCaps(body, "members");
  if ((body && "org" in body && org === undefined) || projects === false || members === false) return Response.json({ error: "budgets are dollar amounts from 0 to 1,000,000, or null for no limit" }, { status: 400 });
  await settings.updateCaps({ ...(org !== undefined ? { org } : {}), ...(projects ? { projects } : {}), ...(members ? { members } : {}) });
  await Promise.all((await settings.projects()).map((p) => changed(p.name).catch(() => undefined)));
  return Response.json(await settings.spending(Date.now()));
}
