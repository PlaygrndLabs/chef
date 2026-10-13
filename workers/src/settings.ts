import { DurableObject } from "cloudflare:workers";
import { applyUpdate, describeSettings, NO_SETTINGS, resolveSettings, type AppSettings, type Resolved } from "@chef/adapters/settings";
import type { ProjectEntry } from "./projects.ts";
import { hashPassword, passwordProblem, sessionCookie, type Credential, type StoredPassword } from "./access.ts";

const SETTINGS = "providers";
const PASSWORD = "password";
const PROJECTS = "projects";

export class Settings extends DurableObject<Env> {
  async read(): Promise<AppSettings> {
    return { ...NO_SETTINGS, ...(await this.ctx.storage.get<Partial<AppSettings>>(SETTINGS)) };
  }

  async write(settings: AppSettings): Promise<void> {
    await this.ctx.storage.put(SETTINGS, settings);
  }

  async password(): Promise<StoredPassword | null> {
    return (await this.ctx.storage.get<StoredPassword>(PASSWORD)) ?? null;
  }

  async claimPassword(password: StoredPassword): Promise<boolean> {
    if (await this.ctx.storage.get(PASSWORD)) return false;
    await this.ctx.storage.put(PASSWORD, password);
    return true;
  }

  async replacePassword(password: StoredPassword): Promise<void> {
    await this.ctx.storage.put(PASSWORD, password);
  }

  async projects(): Promise<readonly ProjectEntry[]> {
    return (await this.ctx.storage.get<ProjectEntry[]>(PROJECTS)) ?? [];
  }

  async addProject(entry: ProjectEntry): Promise<boolean> {
    const list = await this.projects();
    if (list.some((p) => p.name === entry.name)) return false;
    await this.ctx.storage.put(PROJECTS, [...list, entry]);
    return true;
  }
}

export function settingsStub(env: Env): DurableObjectStub<Settings> {
  return env.SETTINGS.get(env.SETTINGS.idFromName("global"));
}

export async function currentSettings(env: Env): Promise<Resolved> {
  return resolveSettings(await settingsStub(env).read(), env);
}

export async function credential(env: Env): Promise<Credential | null> {
  if (env.CHEF_PASSWORD) return { kind: "deployment", password: env.CHEF_PASSWORD };
  const stored = await settingsStub(env).password();
  return stored ? { kind: "app", ...stored } : null;
}

export function claimPassword(env: Env): (password: StoredPassword) => Promise<boolean> {
  return (password) => settingsStub(env).claimPassword(password);
}

async function view(env: Env, saved: AppSettings) {
  return { ...describeSettings(saved, env), password: env.CHEF_PASSWORD ? "deployment" : "app" };
}

export async function settingsRequest(request: Request, env: Env): Promise<Response> {
  const settings = settingsStub(env);
  const saved = await settings.read();
  if (request.method === "GET") return Response.json(await view(env, saved));
  if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body && "password" in body) {
    const { password, ...rest } = body;
    if (env.CHEF_PASSWORD) return Response.json({ error: "the password is set by the deployment's CHEF_PASSWORD secret" }, { status: 409 });
    const problem = typeof password === "string" ? passwordProblem(password) : "the password must be text";
    if (problem) return Response.json({ error: problem }, { status: 400 });
    if (Object.keys(rest).length > 0) return Response.json({ error: "change the password on its own" }, { status: 400 });
    const stored = await hashPassword(password as string);
    await settings.replacePassword(stored);
    return Response.json(await view(env, saved), { headers: { "set-cookie": await sessionCookie({ kind: "app", ...stored }) } });
  }
  const result = applyUpdate(saved, body);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  await settings.write(result.settings);
  return Response.json(await view(env, result.settings));
}
