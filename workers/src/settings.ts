import { DurableObject } from "cloudflare:workers";
import { applyUpdate, describeSettings, NO_SETTINGS, resolveSettings, type AppSettings, type Resolved } from "@chef/adapters/settings";
import type { ProjectEntry } from "./projects.ts";
import type { GitHubAppCredentials } from "@chef/adapters/github-app";
import { AgentSettings, type AgentConfig, type AgentVersion, type SaveResult, type StoredAgents } from "@chef/core";
import { deploymentPassword, hashPassword, passwordProblem, sessionCookie, type Credential, type StoredPassword } from "./access.ts";
import { DurableStore } from "./do-store.ts";

const SETTINGS = "providers";
const PASSWORD = "password";
const PROJECTS = "projects";
const GITHUB_APP = "github/app";
const GITHUB_LINKS = "github/links";
const GITHUB_PENDING = "github/pending";
const PENDING_MS = 60 * 60_000;

export interface PendingConnect {
  readonly state: string;
  readonly returnTo: string;
  readonly at: number;
}

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

  async githubApp(): Promise<GitHubAppCredentials | null> {
    return (await this.ctx.storage.get<GitHubAppCredentials>(GITHUB_APP)) ?? null;
  }

  async saveGitHubApp(app: GitHubAppCredentials | null): Promise<void> {
    if (app) await this.ctx.storage.put(GITHUB_APP, app);
    else await this.ctx.storage.delete(GITHUB_APP);
  }

  async beginConnect(pending: PendingConnect): Promise<void> {
    await this.ctx.storage.put(GITHUB_PENDING, pending);
  }

  async pendingConnect(state: string, now: number): Promise<PendingConnect | null> {
    const pending = await this.ctx.storage.get<PendingConnect>(GITHUB_PENDING);
    return pending && pending.state === state && now - pending.at < PENDING_MS ? pending : null;
  }

  async linkRepository(project: string, repository: string | null): Promise<void> {
    const stored = (await this.ctx.storage.get<Record<string, string[]>>(GITHUB_LINKS)) ?? {};
    const links = Object.fromEntries(
      Object.entries(stored)
        .map(([name, projects]) => [name, projects.filter((p) => p !== project)] as const)
        .filter(([, projects]) => projects.length > 0),
    );
    if (repository) links[repository.toLowerCase()] = [...(links[repository.toLowerCase()] ?? []), project];
    await this.ctx.storage.put(GITHUB_LINKS, links);
  }

  async agentsCurrent(): Promise<StoredAgents> {
    return this.agentSettings().current();
  }

  async agentsHistory(): Promise<AgentVersion[]> {
    return this.agentSettings().history();
  }

  async agentsSave(config: AgentConfig, summary: string, expected: number | null): Promise<SaveResult> {
    return this.agentSettings().save(config, summary, expected);
  }

  async agentsRestore(version: number): Promise<SaveResult> {
    return this.agentSettings().restore(version);
  }

  private agentSettings(): AgentSettings {
    return new AgentSettings(new DurableStore(this.ctx.storage));
  }

  async linkedProjects(repository: string): Promise<string[]> {
    return (await this.ctx.storage.get<Record<string, string[]>>(GITHUB_LINKS))?.[repository.toLowerCase()] ?? [];
  }
}

export function settingsStub(env: Env): DurableObjectStub<Settings> {
  return env.SETTINGS.get(env.SETTINGS.idFromName("global"));
}

export async function currentSettings(env: Env): Promise<Resolved> {
  return resolveSettings(await settingsStub(env).read(), env);
}

export async function credential(env: Env): Promise<Credential | null> {
  const password = deploymentPassword(env);
  if (password) return { kind: "deployment", password };
  const stored = await settingsStub(env).password();
  return stored ? { kind: "app", ...stored } : null;
}

export function claimPassword(env: Env): (password: StoredPassword) => Promise<boolean> {
  return (password) => settingsStub(env).claimPassword(password);
}

async function view(env: Env, saved: AppSettings) {
  return { ...describeSettings(saved, env), password: deploymentPassword(env) ? "deployment" : "app" };
}

export async function settingsRequest(request: Request, env: Env): Promise<Response> {
  const settings = settingsStub(env);
  const saved = await settings.read();
  if (request.method === "GET") return Response.json(await view(env, saved));
  if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body && "password" in body) {
    const { password, ...rest } = body;
    if (deploymentPassword(env)) return Response.json({ error: "the password is set by the deployment's CHEF_PASSWORD secret" }, { status: 409 });
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

export function agentStore(env: Env) {
  const stub = settingsStub(env);
  return {
    current: () => stub.agentsCurrent(),
    history: () => stub.agentsHistory(),
    save: (config: AgentConfig, summary: string, expected: number | null) => stub.agentsSave(config, summary, expected),
    restore: (version: number) => stub.agentsRestore(version),
  };
}
