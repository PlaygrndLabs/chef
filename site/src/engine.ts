import type { Engine } from "./member.ts";

export async function engineProjects(engine: Engine): Promise<string[] | null> {
  const response = await fetch(`${engine.url}/api/projects`, { headers: { authorization: `Bearer ${engine.secret}` } }).catch(() => null);
  const body = (response?.ok ? await response.json().catch(() => null) : null) as { projects?: readonly { name?: unknown }[] } | null;
  return Array.isArray(body?.projects) ? body.projects.flatMap((p) => (typeof p?.name === "string" ? [p.name] : [])) : null;
}
