import type { Engine } from "./member.ts";

export interface Spending {
  readonly caps: { readonly org: number | null; readonly projects: Readonly<Record<string, number>>; readonly members: Readonly<Record<string, number>> };
  readonly ledger: { readonly month: string; readonly org: number; readonly projects: Readonly<Record<string, number>>; readonly members: Readonly<Record<string, number>> };
}

const TIMEOUT = 8000;

const call = (engine: Engine, path: string, init: RequestInit = {}) =>
  fetch(`${engine.url}${path}`, { ...init, headers: { authorization: `Bearer ${engine.secret}`, ...(init.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);

export async function engineProjects(engine: Engine): Promise<string[] | null> {
  const response = await call(engine, "/api/projects");
  const body = (response?.ok ? await response.json().catch(() => null) : null) as { projects?: readonly { name?: unknown }[] } | null;
  return Array.isArray(body?.projects) ? body.projects.flatMap((p) => (typeof p?.name === "string" ? [p.name] : [])) : null;
}

const readSpending = async (response: Response | null): Promise<Spending | null> => {
  const body = (response?.ok ? await response.json().catch(() => null) : null) as Spending | null;
  return body && typeof body.ledger?.org === "number" && typeof body.ledger.month === "string" && body.caps ? body : null;
};

export async function engineSpending(engine: Engine): Promise<Spending | null> {
  return readSpending(await call(engine, "/api/usage"));
}

export async function setEngineBudget(engine: Engine, dollars: number | null): Promise<Spending | null> {
  return readSpending(await call(engine, "/api/usage", { method: "PUT", body: JSON.stringify({ org: dollars }) }));
}
