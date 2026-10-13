import { authorizeUrl, cookies, decodePending, encodePending, OAUTH_COOKIE, randomToken, readGrant, readInstall, SESSION_COOKIE, SESSION_SECONDS, sessionId, setCookie, tokenRequest } from "./oauth.ts";
import { oauthClient, type Env } from "./env.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const redirect = (location: string, setCookies: readonly string[] = []) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
};

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const jar = cookies(request.headers.get("cookie"));
  const client = oauthClient(env);

  if (url.pathname === "/start") {
    if (!client) return redirect("/?signin=unavailable#get-started");
    const pending = { state: randomToken(), verifier: randomToken() };
    return redirect(await authorizeUrl(client, `${url.origin}/callback`, pending), [setCookie(OAUTH_COOKIE, encodePending(pending), 600, "/callback")]);
  }

  if (url.pathname === "/callback") {
    const clear = setCookie(OAUTH_COOKIE, "", 0, "/callback");
    const pending = decodePending(jar[OAUTH_COOKIE]);
    const code = url.searchParams.get("code");
    if (!client || !pending || !code || url.searchParams.get("state") !== pending.state) return redirect("/?signin=cancelled#get-started", [clear]);
    const response = await fetch(tokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: `${url.origin}/callback`, code_verifier: pending.verifier })).catch(() => null);
    const grant = readGrant(response?.ok ? await response.json().catch(() => null) : null, Date.now());
    if (!grant) return redirect("/?signin=failed#get-started", [clear]);
    const sid = randomToken();
    await env.SETUP.get(env.SETUP.idFromName(sid)).begin(grant);
    return redirect("/setup", [clear, setCookie(SESSION_COOKIE, sid, SESSION_SECONDS)]);
  }

  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET" && request.headers.get("origin") !== url.origin) return json({ error: "cross-site request refused" }, 403);
    const sid = sessionId(jar[SESSION_COOKIE]);
    const setup = sid ? env.SETUP.get(env.SETUP.idFromName(sid)) : null;

    if (url.pathname === "/api/session" && request.method === "GET") {
      if (!setup) return json({ signedIn: false, accounts: [], install: null });
      const install = await setup.status();
      const signedIn = await setup.signedIn();
      return json({ signedIn, accounts: signedIn && install.status === "idle" ? await setup.accounts() : [], install: install.status === "idle" ? null : install });
    }

    if (url.pathname === "/api/install" && request.method === "GET") {
      if (!setup) return json({ error: "sign in with Cloudflare first" }, 401);
      return json(await setup.status());
    }

    if (url.pathname === "/api/install" && request.method === "POST") {
      if (!setup) return json({ error: "sign in with Cloudflare first" }, 401);
      const input = readInstall(await request.json().catch(() => null));
      if (typeof input === "string") return json({ error: input }, 400);
      const started = await setup.install(input);
      return typeof started === "string" ? json({ error: started }, 409) : json(started, 202);
    }

    if (url.pathname === "/api/signout" && request.method === "POST") {
      if (setup) await setup.end();
      return json({ ok: true }, 200, { "set-cookie": setCookie(SESSION_COOKIE, "", 0) });
    }

    return json({ error: "not found" }, 404);
  }

  return env.ASSETS.fetch(request);
}
