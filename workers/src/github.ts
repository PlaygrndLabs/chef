import { appManifest, appName, BrokeredGitHub, convertManifest, GitHubApp, installUrl, manifestAction, readBroker, viewApp, type GitHubAccess, type GitHubAppCredentials } from "@chef/adapters/github-app";
import type { Caller } from "./access.ts";
import { manifestPage, publicOrigin, safeReturn } from "./github-pages.ts";
import { settingsStub } from "./settings.ts";
import { validSignature } from "./webhook.ts";

const ORGANIZATION = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export async function gitHubApp(env: Env): Promise<GitHubAccess | null> {
  const settings = settingsStub(env);
  const broker = await settings.githubBroker();
  if (broker) return new BrokeredGitHub(broker);
  const credentials = await settings.githubApp();
  return credentials ? new GitHubApp(credentials) : null;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const manages = (caller: Caller) => caller.kind === "browser" || caller.grant.kind === "controller";

const redirect = (location: string) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

async function begin(env: Env, returnTo: string): Promise<string> {
  const state = crypto.randomUUID();
  await settingsStub(env).beginConnect({ state, returnTo, at: Date.now() });
  return state;
}

async function sharedRequest(request: Request, env: Env, caller: Caller, action: string): Promise<Response | null> {
  const settings = settingsStub(env);
  if (action === "/broker") {
    if (!manages(caller)) return Response.json({ error: "only the owner or a managing app can change where GitHub access comes from" }, { status: 403 });
    if (request.method === "DELETE") {
      await settings.saveGitHubBroker(null);
      return Response.json({ ok: true });
    }
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const broker = readBroker(await request.json().catch(() => null));
    if (typeof broker === "string") return Response.json({ error: broker }, { status: 400 });
    await settings.saveGitHubBroker(broker);
    return Response.json({ ok: true });
  }
  if (action === "/pushed") {
    if (!manages(caller)) return Response.json({ error: "only a managing app can report pushes" }, { status: 403 });
    if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    const push = (await request.json().catch(() => null)) as { repository?: unknown; ref?: unknown } | null;
    if (typeof push?.repository !== "string" || typeof push.ref !== "string") return Response.json({ error: "send the repository and ref that were pushed" }, { status: 400 });
    await pushed(env, push.repository, push.ref);
    return Response.json({ ok: true }, { status: 202 });
  }
  const broker = await settings.githubBroker();
  if (!broker) return null;
  const shared = new BrokeredGitHub(broker);
  if (action === "" && request.method === "GET") {
    try {
      const described = await shared.describe();
      if (described.installations.length === 0) return Response.json({ app: null, shared: true, repositories: [] });
      return Response.json({ app: described.app, shared: true, repositories: await shared.repositories() });
    } catch (error) {
      return Response.json({ app: null, shared: true, repositories: [], error: message(error) });
    }
  }
  if (action === "" && request.method === "DELETE") {
    await settings.saveGitHubBroker(null);
    return Response.json({ app: null, repositories: [] });
  }
  if (action === "/connect" && request.method === "GET") {
    try {
      const target = new URL((await shared.describe()).app.installUrl);
      target.searchParams.set("returnTo", safeReturn(new URL(request.url).searchParams.get("returnTo")));
      return redirect(target.toString());
    } catch (error) {
      return Response.json({ error: message(error) }, { status: 502 });
    }
  }
  return null;
}

export async function gitHubRequest(request: Request, env: Env, caller: Caller): Promise<Response> {
  const url = new URL(request.url);
  const settings = settingsStub(env);
  const action = url.pathname.slice("/api/github".length);
  const shared = await sharedRequest(request, env, caller, action);
  if (shared) return shared;
  if (action === "" && request.method === "GET") {
    const app = await settings.githubApp();
    if (!app) return Response.json({ app: null, repositories: [] });
    try {
      return Response.json({ app: viewApp(app), repositories: await new GitHubApp(app).repositories() });
    } catch (error) {
      return Response.json({ app: viewApp(app), repositories: [], error: message(error) });
    }
  }
  if (action === "" && request.method === "DELETE") {
    await settings.saveGitHubApp(null);
    return Response.json({ app: null, repositories: [] });
  }
  if (action === "/connect" && request.method === "GET") {
    const returnTo = safeReturn(url.searchParams.get("returnTo"));
    const app = await settings.githubApp();
    const state = await begin(env, returnTo);
    if (app) return redirect(installUrl(app, state));
    const organization = url.searchParams.get("organization")?.trim() || null;
    if (organization && !ORGANIZATION.test(organization)) return Response.json({ error: "that is not a GitHub organization name" }, { status: 400 });
    const suffix = crypto.randomUUID().slice(0, 4);
    return manifestPage(manifestAction(organization, state), appManifest(url.origin, appName(url.hostname, suffix), publicOrigin(request)));
  }
  if (action === "/created" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const pending = await settings.pendingConnect(url.searchParams.get("state") ?? "", Date.now());
    if (!code || !pending) return Response.json({ error: "this GitHub sign-in link expired; start again from chef" }, { status: 400 });
    let app: GitHubAppCredentials;
    try {
      app = await convertManifest(code);
    } catch (error) {
      return Response.json({ error: message(error) }, { status: 502 });
    }
    await settings.saveGitHubApp(app);
    return redirect(installUrl(app, pending.state));
  }
  if (action === "/installed" && request.method === "GET") {
    const pending = await settings.pendingConnect(url.searchParams.get("state") ?? "", Date.now());
    return redirect(pending?.returnTo ?? "/");
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

interface PushPayload {
  readonly ref?: string;
  readonly repository?: { readonly full_name?: string };
}

export async function gitHubWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const settings = settingsStub(env);
  const app = await settings.githubApp();
  if (!app) return Response.json({ error: "Chef has no GitHub App" }, { status: 404 });
  const body = await request.text();
  if (!(await validSignature(app.webhookSecret, body, request.headers.get("x-hub-signature-256")))) return Response.json({ error: "bad signature" }, { status: 401 });
  if (request.headers.get("x-github-event") !== "push") return Response.json({ ok: true });
  const push = JSON.parse(body) as PushPayload;
  const repository = push.repository?.full_name;
  if (!repository || !push.ref) return Response.json({ ok: true });
  await pushed(env, repository, push.ref);
  return Response.json({ ok: true }, { status: 202 });
}

async function pushed(env: Env, repository: string, ref: string): Promise<void> {
  for (const project of await settingsStub(env).linkedProjects(repository)) {
    const stub = env.PROJECT.get(env.PROJECT.idFromName(project)) as unknown as { gitPushed(ref: string): Promise<void> };
    await stub.gitPushed(ref);
  }
}
