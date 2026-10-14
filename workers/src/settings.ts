import { DurableObject } from "cloudflare:workers";
import { applyUpdate, describeSettings, NO_SETTINGS, resolveSettings, type AppSettings, type Resolved } from "@chef/adapters/settings";
import type { ProjectEntry } from "@chef/adapters/projects";
import type { GitHubAppCredentials } from "@chef/adapters/github-app";
import type { SharedInstructions } from "@chef/adapters/guidance";
import { addSpend, AgentSettings, emptyLedger, monthOf, NO_CAPS, overCap, setCaps, type AgentConfig, type AgentVersion, type Caps, type Ledger, type SaveResult, type StoredAgents } from "@chef/core";
import { aesCipher, applyEnvUpdate, envKeyBytes, newEnvKey, viewEnv, type EnvCipher, type StoredEnv } from "@chef/adapters/project-env";
import { deploymentPassword, hashPassword, homeOrigin, passwordProblem, sessionCookie, type Access, type Caller, type Credential, type StoredPassword } from "./access.ts";
import { deploymentGrant, deploymentKey, mintGrant, readGrantRequest, viewGrant, type Grant, type GrantView } from "./grants.ts";
import { mintShare, readShareRequest, SHARE_ROUTE, SHARES_ROUTE, viewShare, type ShareKind, type ShareView } from "./shares.ts";
import { DurableStore } from "./do-store.ts";

const SETTINGS = "providers";
const PASSWORD = "password";
const SEALED = "access/sealed";
const GRANT = "access/grant/";
const USED = "access/used/";
const TOUCH_MS = 60_000;
const PROJECTS = "projects";
const GITHUB_APP = "github/app";
const GITHUB_LINKS = "github/links";
const GITHUB_PENDING = "github/pending";
const ENV_KEY = "env/key";
const SHARED_ENV = "env/shared";
const SHARED_INSTRUCTIONS = "instructions/shared";
const CAPS = "spend/caps";
const LEDGER = "spend/ledger";
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

  async sealed(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>(SEALED)) === true;
  }

  async grant(id: string): Promise<Grant | null> {
    return (await this.ctx.storage.get<Grant>(`${GRANT}${id}`)) ?? null;
  }

  async grants(): Promise<{ readonly grants: Grant[]; readonly used: Record<string, number> }> {
    const grants = [...(await this.ctx.storage.list<Grant>({ prefix: GRANT })).values()];
    const used = Object.fromEntries([...(await this.ctx.storage.list<number>({ prefix: USED })).entries()].map(([key, at]) => [key.slice(USED.length), at]));
    return { grants, used };
  }

  async addGrant(grant: Grant): Promise<void> {
    await this.ctx.storage.put({ [`${GRANT}${grant.id}`]: grant, [SEALED]: true });
  }

  async removeGrant(id: string): Promise<boolean> {
    const existed = await this.ctx.storage.delete(`${GRANT}${id}`);
    await this.ctx.storage.delete(`${USED}${id}`);
    return existed;
  }

  async touchGrant(id: string, at: number): Promise<void> {
    await this.ctx.storage.put({ [`${USED}${id}`]: at, [SEALED]: true });
  }

  async claimPassword(password: StoredPassword): Promise<boolean> {
    if (await this.ctx.storage.get(PASSWORD)) return false;
    await this.ctx.storage.put({ [PASSWORD]: password, [SEALED]: true });
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

  async envKey(): Promise<string> {
    const existing = await this.ctx.storage.get<string>(ENV_KEY);
    if (existing) return existing;
    const key = newEnvKey();
    await this.ctx.storage.put(ENV_KEY, key);
    return key;
  }

  async sharedEnv(): Promise<StoredEnv> {
    return (await this.ctx.storage.get<StoredEnv>(SHARED_ENV)) ?? {};
  }

  async saveSharedEnv(env: StoredEnv): Promise<void> {
    await this.ctx.storage.put(SHARED_ENV, env);
  }

  async sharedInstructions(): Promise<SharedInstructions | null> {
    return (await this.ctx.storage.get<SharedInstructions>(SHARED_INSTRUCTIONS)) ?? null;
  }

  async saveSharedInstructions(value: SharedInstructions): Promise<void> {
    await this.ctx.storage.put(SHARED_INSTRUCTIONS, value);
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

  async spending(now: number): Promise<{ readonly caps: Caps; readonly ledger: Ledger }> {
    const month = monthOf(now);
    const ledger = (await this.ctx.storage.get<Ledger>(LEDGER)) ?? emptyLedger(month);
    return { caps: (await this.ctx.storage.get<Caps>(CAPS)) ?? NO_CAPS, ledger: ledger.month === month ? ledger : emptyLedger(month) };
  }

  async recordSpend(project: string, by: string | null, micros: number, now: number): Promise<void> {
    const ledger = (await this.ctx.storage.get<Ledger>(LEDGER)) ?? emptyLedger(monthOf(now));
    await this.ctx.storage.put(LEDGER, addSpend(ledger, monthOf(now), project, by, micros));
  }

  async spendBlocked(project: string, by: string | null, now: number): Promise<string | null> {
    const { caps, ledger } = await this.spending(now);
    return overCap(caps, ledger, monthOf(now), project, by);
  }

  async updateCaps(update: Parameters<typeof setCaps>[1]): Promise<Caps> {
    const next = setCaps((await this.ctx.storage.get<Caps>(CAPS)) ?? NO_CAPS, update);
    await this.ctx.storage.put(CAPS, next);
    return next;
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

const touched = new Map<string, number>();

export function access(env: Env, waitUntil: (work: Promise<unknown>) => void): Access {
  const settings = settingsStub(env);
  return {
    password: () => credential(env),
    deploymentKey: deploymentKey(env),
    sealed: () => settings.sealed(),
    grant: (id) => settings.grant(id),
    claim: (password) => settings.claimPassword(password),
    used: (grant) => {
      const now = Date.now();
      if (now - (touched.get(grant.id) ?? 0) < TOUCH_MS) return;
      touched.set(grant.id, now);
      waitUntil(settings.touchGrant(grant.id, now).catch(() => undefined));
    },
    home: homeOrigin(env),
  };
}

async function listGrants(env: Env): Promise<GrantView[]> {
  const { grants, used } = await settingsStub(env).grants();
  const key = deploymentKey(env);
  const fromDeployment = key ? [await deploymentGrant(key)] : [];
  return [...fromDeployment.map((grant) => viewGrant(grant, "deployment", used[grant.id] ?? null)), ...grants.filter((grant) => grant.kind !== "share").sort((a, b) => a.createdAt - b.createdAt).map((grant) => viewGrant(grant, "app", used[grant.id] ?? null))];
}

export async function keysRequest(request: Request, env: Env, caller: Caller): Promise<Response> {
  const url = new URL(request.url);
  const id = /^\/api\/keys\/([a-z0-9]{12})$/.exec(url.pathname)?.[1] ?? null;
  if (url.pathname === "/api/keys" && request.method === "GET") return Response.json({ keys: await listGrants(env) });
  if (url.pathname === "/api/keys" && request.method === "POST") {
    const now = Date.now();
    const input = readGrantRequest(await request.json().catch(() => null), now);
    if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
    if (input.kind === "controller" && caller.kind === "grant" && caller.grant.kind !== "controller") return Response.json({ error: "an API key can make other API keys, not keys for a managing app" }, { status: 403 });
    const { grant, token } = await mintGrant(input, now);
    await settingsStub(env).addGrant(grant);
    return Response.json({ key: viewGrant(grant, "app", null), token }, { status: 201 });
  }
  if (id && request.method === "DELETE") {
    const key = deploymentKey(env);
    if (key && (await deploymentGrant(key)).id === id) return Response.json({ error: "this key comes from the deployment's CHEF_API_KEY secret: replace or remove it there" }, { status: 409 });
    const settings = settingsStub(env);
    const grant = await settings.grant(id);
    if (!grant) return Response.json({ error: "no such key" }, { status: 404 });
    if (grant.kind === "controller" && caller.kind === "grant" && caller.grant.kind !== "controller") return Response.json({ error: "an API key cannot revoke the key of a managing app" }, { status: 403 });
    await settings.removeGrant(id);
    return new Response(null, { status: 204 });
  }
  return Response.json({ error: "method not allowed" }, { status: 405 });
}

export type DescribeShare = (project: string, kind: ShareKind, id: string) => Promise<{ readonly name: string; readonly scopes: readonly string[] } | { readonly error: string }>;

export async function sharesRequest(request: Request, env: Env, describe: DescribeShare): Promise<Response> {
  const url = new URL(request.url);
  const settings = settingsStub(env);
  const project = SHARES_ROUTE.exec(url.pathname)?.[1] ?? null;
  if (project && request.method === "GET") {
    const { grants, used } = await settings.grants();
    const shares = grants
      .map((grant) => viewShare(grant, used[grant.id] ?? null))
      .filter((share): share is ShareView => share !== null && share.project === project)
      .sort((a, b) => b.createdAt - a.createdAt);
    return Response.json({ shares });
  }
  if (project && request.method === "POST") {
    const now = Date.now();
    const input = readShareRequest(await request.json().catch(() => null), now);
    if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
    const target = await describe(project, input.kind, input.id);
    if ("error" in target) return Response.json({ error: target.error }, { status: 404 });
    const { grant, token } = await mintShare(input, target, now);
    await settings.addGrant(grant);
    return Response.json({ share: viewShare(grant, null), token }, { status: 201 });
  }
  const id = SHARE_ROUTE.exec(url.pathname)?.[1] ?? null;
  if (id && request.method === "DELETE") {
    const grant = await settings.grant(id);
    if (!grant || grant.kind !== "share") return Response.json({ error: "no such link" }, { status: 404 });
    await settings.removeGrant(id);
    return new Response(null, { status: 204 });
  }
  return Response.json({ error: "method not allowed" }, { status: 405 });
}

async function view(env: Env, saved: AppSettings) {
  return { ...describeSettings(saved, env), password: deploymentPassword(env) ? "deployment" : (await settingsStub(env).password()) ? "app" : "none" };
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

export function envCipher(env: Env): EnvCipher {
  let cipher: Promise<EnvCipher> | null = null;
  const sealed = (): Promise<EnvCipher> => {
    cipher ??= settingsStub(env)
      .envKey()
      .then((key) => aesCipher(envKeyBytes(key)));
    cipher.catch(() => (cipher = null));
    return cipher;
  };
  return { encrypt: async (text) => (await sealed()).encrypt(text), decrypt: async (text) => (await sealed()).decrypt(text) };
}

export async function sharedEnvRequest(request: Request, env: Env, changed: (project: string) => Promise<void>): Promise<Response> {
  const settings = settingsStub(env);
  const cipher = envCipher(env);
  const stored = await settings.sharedEnv();
  if (request.method === "GET") return Response.json(await viewEnv(stored, cipher, []));
  if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
  const result = await applyEnvUpdate(stored, await request.json().catch(() => null), cipher, Date.now());
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  await settings.saveSharedEnv(result.env);
  const projects = await settings.projects();
  await Promise.all(projects.map((p) => changed(p.name).catch((error: unknown) => console.error(`telling ${p.name} about the shared environment failed`, error))));
  return Response.json(await viewEnv(result.env, cipher, []));
}
