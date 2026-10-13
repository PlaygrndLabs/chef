import { directory, member as memberOf, oauthClient, organization, type Env } from "./env.ts";
import { API, authorizeUrl, canSeeAccount, cookies, decodePending, encodePending, OAUTH_COOKIE, randomToken, readGrant, readInstall, readProfile, readSession, SESSION_COOKIE, SESSION_SECONDS, setCookie, signSession, tokenRequest, type OAuthClient, type Session } from "./oauth.ts";
import type { OrgAccess } from "./organization.ts";
import { can, isId, readOrgName, type OrgSummary } from "./orgs.ts";
import { ENGINE_PATH, proxy } from "./proxy.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const redirect = (location: string, setCookies: readonly string[] = []) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
};
const page = (env: Env, request: Request, path: string) => env.ASSETS.fetch(new Request(new URL(path, request.url), { headers: request.headers }));
const sessionCookie = async (client: OAuthClient, session: Session) => setCookie(SESSION_COOKIE, await signSession(client.clientSecret, session, Date.now()), SESSION_SECONDS);

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
    const admin = await canSeeAccount(grant.token, env.CF_ACCOUNT_ID);
    const signed = await directory(env).signIn({ provider: "cloudflare", subject: profile.id, email: profile.email }, admin);
    const org = organization(env, signed.org.id);
    await org.setup({ id: signed.org.id, name: signed.org.name }, { userId: signed.userId, email: profile.email, role: signed.org.role });
    const engine = await org.engine();
    await memberOf(env, signed.userId).signIn(profile, grant, admin, { id: signed.org.id, canSetUp: can(signed.org.role, "setup"), engine });
    return redirect(engine ? "/" : "/setup", [clear, await sessionCookie(client, { userId: signed.userId, orgId: signed.org.id })]);
  }

  if (path === "/auth/signout") {
    if (request.method !== "POST" || !sameSite) return json({ error: "sign out from chef's menu" }, 405);
    return redirect("/", [setCookie(SESSION_COOKIE, "", 0)]);
  }

  const session = client ? await readSession(client.clientSecret, jar[SESSION_COOKIE], Date.now()) : null;
  const org = session ? organization(env, session.orgId) : null;
  let checked: Promise<OrgAccess | null> | null = null;
  const access = () => (checked ??= session && org ? org.access(session.userId).catch(() => null) : Promise.resolve(null));
  const member = session ? memberOf(env, session.userId) : null;

  if (path.startsWith("/site/api/")) {
    if (!sameSite) return json({ error: "cross-site request refused" }, 403);
    const role = (await access())?.role ?? null;
    if (!client || !session || !org || !member || !role) return json({ error: "sign in with Cloudflare first" }, 401);
    const switchTo = async (summary: OrgSummary) => json({ org: summary }, 200, { "set-cookie": await sessionCookie(client, { userId: session.userId, orgId: summary.id }) });
    if (path === "/site/api/me" && request.method === "GET") {
      const [view, current, orgs] = await Promise.all([member.view(session.orgId), org.view(session.userId), directory(env).orgs(session.userId)]);
      const canSetUp = view.canSetUp && can(role, "setup");
      return json({ ...view, canSetUp, engine: current?.engine ?? null, org: current, orgs, accounts: canSetUp && !view.install ? await member.accounts() : [] });
    }
    if (path === "/site/api/install" && request.method === "GET") return json(await member.status());
    if (path === "/site/api/admin/members" && request.method === "GET") {
      if (!(await member.admin())) return json({ error: "only PlaygrndLabs admins can see members" }, 403);
      return json(await directory(env).list());
    }
    if (path === "/site/api/install" && request.method === "POST") {
      if (!can(role, "setup")) return json({ error: "only owners and admins of this organization can set up chef" }, 403);
      const input = readInstall(await request.json().catch(() => null));
      if (typeof input === "string") return json({ error: input }, 400);
      const taken = await directory(env).accountTakenBy(input.accountId, session.orgId);
      if (taken) return json({ error: `this Cloudflare account already runs chef for ${taken}; choose another account` }, 409);
      const started = await member.install({ orgId: session.orgId, accountId: input.accountId, engine: await org.engine() });
      return typeof started === "string" ? json({ error: started }, 409) : json(started, 202);
    }
    if (path === "/site/api/install" && request.method === "DELETE") {
      await member.dismiss();
      return json({ ok: true });
    }
    if (path === "/site/api/orgs" && request.method === "GET") return json({ current: session.orgId, orgs: await directory(env).orgs(session.userId) });
    if (path === "/site/api/orgs" && request.method === "POST") {
      const name = readOrgName(await request.json().catch(() => null));
      if (!name) return json({ error: "give the organization a name of up to 60 characters" }, 400);
      const created = await directory(env).createOrg(session.userId, name);
      const view = await member.view(session.orgId);
      await organization(env, created.id).setup({ id: created.id, name }, { userId: session.userId, email: view.email, role: "owner" });
      await directory(env).use(session.userId, created.id);
      return switchTo(created);
    }
    if (path === "/site/api/orgs/switch" && request.method === "POST") {
      const orgId = ((await request.json().catch(() => null)) as { orgId?: unknown } | null)?.orgId;
      const target = isId(orgId, "org") ? await directory(env).use(session.userId, orgId) : null;
      if (!target || !(await organization(env, target.id).access(session.userId))) return json({ error: "you are not a member of that organization" }, 404);
      return switchTo(target);
    }
    if (path === "/site/api/org" && request.method === "PATCH") {
      if (!can(role, "rename")) return json({ error: "only owners and admins can rename this organization" }, 403);
      const name = readOrgName(await request.json().catch(() => null));
      if (!name) return json({ error: "give the organization a name of up to 60 characters" }, 400);
      await org.rename(name);
      await directory(env).renameOrg(session.orgId, name);
      return json({ org: await org.view(session.userId) });
    }
    if (path === "/site/api/org/members" && request.method === "GET") return json({ members: await org.members() });
    return json({ error: "not found" }, 404);
  }

  if (path === "/api/app" && request.method === "GET" && session && org && member && (await access())) {
    const [view, current, orgs] = await Promise.all([member.view(session.orgId), org.view(session.userId), directory(env).orgs(session.userId)]);
    return json({ mode: "cloud", place: "cloud", engine: url.origin, fixed: true, account: view.email, org: current, orgs, ...(view.admin ? { admin: true } : {}) });
  }

  if (ENGINE_PATH.test(path)) {
    if (!sameSite) return json({ error: "cross-site request refused" }, 403);
    const signedIn = await access();
    if (!signedIn?.engine) return json({ error: signedIn ? "chef is not set up for this organization yet" : "sign in with Cloudflare first" }, 401);
    return proxy(request, signedIn.engine, url.origin);
  }

  if (path === "/" || path === "/index.html") {
    const signedIn = await access();
    if (!signedIn) return page(env, request, "/");
    return signedIn.engine ? page(env, request, "/app") : redirect("/setup");
  }

  if (path === "/setup") return (await access()) ? page(env, request, "/setup") : redirect("/");
  if (path === "/admin") return member && (await access()) && (await member.admin()) ? page(env, request, "/admin") : redirect("/");
  if (path === "/app" || path === "/app.html") return redirect("/");

  return env.ASSETS.fetch(request);
}
