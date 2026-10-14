import { appManifest, appName, convertManifest, GitHubApp, installUrl, manifestAction, viewApp, type GitHubAppCredentials } from "@chef/adapters/github-app";
import { manifestPage, publicOrigin, safeReturn } from "./github-pages.ts";
import { settingsStub } from "./settings.ts";
import { validSignature } from "./webhook.ts";

const ORGANIZATION = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export async function gitHubApp(env: Env): Promise<GitHubApp | null> {
  const credentials = await settingsStub(env).githubApp();
  return credentials ? new GitHubApp(credentials) : null;
}

const redirect = (location: string) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

async function begin(env: Env, returnTo: string): Promise<string> {
  const state = crypto.randomUUID();
  await settingsStub(env).beginConnect({ state, returnTo, at: Date.now() });
  return state;
}

export async function gitHubRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const settings = settingsStub(env);
  const action = url.pathname.slice("/api/github".length);
  if (action === "" && request.method === "GET") {
    const app = await settings.githubApp();
    if (!app) return Response.json({ app: null, repositories: [] });
    try {
      return Response.json({ app: viewApp(app), repositories: await new GitHubApp(app).repositories() });
    } catch (error) {
      return Response.json({ app: viewApp(app), repositories: [], error: error instanceof Error ? error.message : String(error) });
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
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
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
  for (const project of await settings.linkedProjects(repository)) {
    const stub = env.PROJECT.get(env.PROJECT.idFromName(project)) as unknown as { gitPushed(ref: string): Promise<void> };
    await stub.gitPushed(push.ref);
  }
  return Response.json({ ok: true }, { status: 202 });
}
