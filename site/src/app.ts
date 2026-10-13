import { oauthClient, type Env } from "./env.ts";
import { API, authorizeUrl, cookies, decodePending, encodePending, OAUTH_COOKIE, randomToken, readGrant, readInstall, readProfile, readSession, SESSION_COOKIE, SESSION_SECONDS, setCookie, signSession, tokenRequest } from "./oauth.ts";
import { ENGINE_PATH, proxy } from "./proxy.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const redirect = (location: string, setCookies: readonly string[] = []) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
};
const page = (env: Env, request: Request, path: string) => env.ASSETS.fetch(new Request(new URL(path, request.url), { headers: request.headers }));

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const jar = cookies(request.headers.get("cookie"));
  const client = oauthClient(env);
  const sameSite = request.headers.get("origin") === null ? request.method === "GET" || request.method === "HEAD" : request.headers.get("origin") === url.origin;

  if (path === "/auth/start") {
    if (!client) return redirect("/?signin=unavailable#get-started");
    const pending = { state: randomToken(), verifier: randomToken() };
    return redirect(await authorizeUrl(client, `${url.origin}/auth/callback`, pending), [setCookie(OAUTH_COOKIE, encodePending(pending), 600, "/auth/callback")]);
  }

  if (path === "/auth/callback") {
    const clear = setCookie(OAUTH_COOKIE, "", 0, "/auth/callback");
    const pending = decodePending(jar[OAUTH_COOKIE]);
    const code = url.searchParams.get("code");
    if (!client || !pending || !code || url.searchParams.get("state") !== pending.state) return redirect("/?signin=cancelled#get-started", [clear]);
    const response = await fetch(tokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: `${url.origin}/auth/callback`, code_verifier: pending.verifier })).catch(() => null);
    const grant = readGrant(response?.ok ? await response.json().catch(() => null) : null, Date.now());
    if (!grant) return redirect("/?signin=failed#get-started", [clear]);
    const user = await fetch(`${API}/user`, { headers: { authorization: `Bearer ${grant.token}` } }).catch(() => null);
    const profile = readProfile(user?.ok ? await user.json().catch(() => null) : null);
    if (!profile) return redirect("/?signin=failed#get-started", [clear]);
    const member = env.MEMBER.get(env.MEMBER.idFromName(profile.id));
    await member.signIn(profile, grant);
    const session = setCookie(SESSION_COOKIE, await signSession(client.clientSecret, profile.id, Date.now()), SESSION_SECONDS);
    return redirect((await member.engine()) ? "/" : "/setup", [clear, session]);
  }

  if (path === "/auth/signout") {
    if (request.method !== "POST" || !sameSite) return json({ error: "sign out from chef's menu" }, 405);
    return redirect("/", [setCookie(SESSION_COOKIE, "", 0)]);
  }

  const userId = client ? await readSession(client.clientSecret, jar[SESSION_COOKIE], Date.now()) : null;
  const member = userId ? env.MEMBER.get(env.MEMBER.idFromName(userId)) : null;

  if (path.startsWith("/site/api/")) {
    if (!sameSite) return json({ error: "cross-site request refused" }, 403);
    if (!member) return json({ error: "sign in with Cloudflare first" }, 401);
    if (path === "/site/api/me" && request.method === "GET") {
      const view = await member.view();
      return json({ ...view, accounts: view.canSetUp && !view.install ? await member.accounts() : [] });
    }
    if (path === "/site/api/install" && request.method === "GET") return json(await member.status());
    if (path === "/site/api/install" && request.method === "POST") {
      const input = readInstall(await request.json().catch(() => null));
      if (typeof input === "string") return json({ error: input }, 400);
      const started = await member.install(input);
      return typeof started === "string" ? json({ error: started }, 409) : json(started, 202);
    }
    if (path === "/site/api/install" && request.method === "DELETE") {
      await member.dismiss();
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  if (path === "/api/app" && request.method === "GET" && member) {
    const view = await member.view();
    return json({ mode: "cloud", place: "cloud", engine: url.origin, fixed: true, account: view.email });
  }

  if (ENGINE_PATH.test(path)) {
    if (!sameSite) return json({ error: "cross-site request refused" }, 403);
    const engine = member ? await member.engine() : null;
    if (!engine) return json({ error: member ? "your chef is not set up yet" : "sign in with Cloudflare first" }, 401);
    return proxy(request, engine, url.origin);
  }

  if (path === "/" || path === "/index.html") {
    if (!member) return page(env, request, "/");
    return (await member.engine()) ? page(env, request, "/app") : redirect("/setup");
  }

  if (path === "/setup") return member ? page(env, request, "/setup") : redirect("/");
  if (path === "/app" || path === "/app.html") return redirect("/");

  return env.ASSETS.fetch(request);
}
