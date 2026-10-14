import { directory, member as memberOf, oauthClient, organization, type Env } from "./env.ts";
import { API, authorizeUrl, canSeeAccount, cookies, decodePending, encodePending, OAUTH_COOKIE, randomToken, readGrant, readInstall, readProfile, readSession, SESSION_COOKIE, SESSION_SECONDS, setCookie, signSession, tokenRequest, type OAuthClient, type Session } from "./oauth.ts";
import type { OrgAccess } from "./organization.ts";
import { engineRule } from "./access.ts";
import { atLeast, can, engineLabel, isId, isLevel, isRole, readEmail, readOrgName, type OrgSummary } from "./orgs.ts";
import { ENGINE_PATH, proxy } from "./proxy.ts";
import { engineProjects } from "./engine.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const redirect = (location: string, setCookies: readonly string[] = []) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
};
const readJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const HOME_PATHS = new Set(["/", "/index.html", "/setup", "/remove", "/api/app"]);

const page = (env: Env, request: Request, path: string) => env.ASSETS.fetch(new Request(new URL(path, request.url), { headers: request.headers }));
const sessionCookie = async (client: OAuthClient, session: Session) => setCookie(SESSION_COOKIE, await signSession(client.clientSecret, session, Date.now()), SESSION_SECONDS);

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const jar = cookies(request.headers.get("cookie"));
  const client = oauthClient(env);
  const sameSite = request.headers.get("origin") === null ? request.method === "GET" || request.method === "HEAD" : request.headers.get("origin") === url.origin;

  if (path === "/auth/start") {
    if (!client) return redirect("/?signin=unavailable");
    const pending = { state: randomToken(), verifier: randomToken(), ...(url.searchParams.get("then") === "remove" ? { then: "remove" as const } : {}) };
    return redirect(await authorizeUrl(client, `${url.origin}/auth/callback`, pending), [setCookie(OAUTH_COOKIE, encodePending(pending), 1800, "/auth/callback")]);
  }

  if (path === "/auth/callback") {
    const clear = setCookie(OAUTH_COOKIE, "", 0, "/auth/callback");
    const pending = decodePending(jar[OAUTH_COOKIE]);
    const code = url.searchParams.get("code");
    if (!client) return redirect("/?signin=unavailable", [clear]);
    if (url.searchParams.has("error") || !code) return redirect("/?signin=cancelled", [clear]);
    if (!pending || url.searchParams.get("state") !== pending.state) return redirect("/?signin=expired", [clear]);
    const response = await fetch(tokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: `${url.origin}/auth/callback`, code_verifier: pending.verifier })).catch(() => null);
    const grant = readGrant(response?.ok ? await response.json().catch(() => null) : null, Date.now());
    if (!grant) return redirect("/?signin=failed", [clear]);
    const user = await fetch(`${API}/user`, { headers: { authorization: `Bearer ${grant.token}` } }).catch(() => null);
    const profile = readProfile(user?.ok ? await user.json().catch(() => null) : null);
    if (!profile) return redirect("/?signin=failed", [clear]);
    const admin = await canSeeAccount(grant.token, env.CF_ACCOUNT_ID);
    const signed = await directory(env).signIn({ provider: "cloudflare", subject: profile.id, email: profile.email }, admin);
    const org = organization(env, signed.org.id);
    await org.setup({ id: signed.org.id, name: signed.org.name, personal: signed.org.personal }, { userId: signed.userId, email: profile.email, role: signed.org.role });
    await Promise.all(signed.joined.map((joined) => organization(env, joined.id).setup({ id: joined.id, name: joined.name, personal: false }, { userId: signed.userId, email: profile.email, role: joined.role })));
    const engine = await org.engine();
    const removing = pending.then === "remove" && can(signed.org.role, "manage");
    await memberOf(env, signed.userId).signIn(profile, grant, admin, { id: signed.org.id, canSetUp: can(signed.org.role, "setup"), engine }, removing);
    return redirect(removing ? "/remove" : engine ? "/" : "/setup", [clear, await sessionCookie(client, { userId: signed.userId, orgId: signed.org.id })]);
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

  if (client && session && (path.startsWith("/site/api/") || HOME_PATHS.has(path)) && !(await access())) {
    const home = await directory(env).home(session.userId).catch(() => null);
    if (home && home.id !== session.orgId) {
      const cookie = await sessionCookie(client, { userId: session.userId, orgId: home.id });
      return request.method === "GET" ? redirect(`${path}${url.search}`, [cookie]) : json({ error: "that organization is gone, so chef took you back to Personal" }, 409, { "set-cookie": cookie });
    }
  }

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
    if (path === "/site/api/install" && request.method === "POST") {
      if (!can(role, "setup")) return json({ error: "only owners and admins of this organization can set up chef" }, 403);
      if (await org.removing()) return json({ error: "chef is being removed from this organization" }, 409);
      const input = readInstall(await request.json().catch(() => null));
      if (typeof input === "string") return json({ error: input }, 400);
      const [current, view] = await Promise.all([org.view(session.userId), member.view(session.orgId)]);
      const started = await member.install({ orgId: session.orgId, orgName: current ? engineLabel(current, view.email) : "org", accountId: input.accountId, engine: await org.engine() });
      return typeof started === "string" ? json({ error: started }, 409) : json(started, 202);
    }
    if (path === "/site/api/install" && request.method === "DELETE") {
      await member.dismiss();
      return json({ ok: true });
    }
    if (path === "/site/api/remove" && request.method === "GET") {
      const [current, view, removal, engine] = await Promise.all([org.view(session.userId), member.view(session.orgId), member.removal(), org.engine()]);
      const owner = can(role, "manage");
      return json({
        org: current,
        allowed: owner,
        signedIn: view.canSetUp,
        engine: owner && engine ? { name: engine.name, accountId: engine.accountId, url: engine.url } : null,
        projects: owner && engine && !removal ? await engineProjects(engine) : null,
        removal,
      });
    }
    if (path === "/site/api/remove" && request.method === "POST") {
      if (!can(role, "manage")) return json({ error: "only owners can delete this organization" }, 403);
      const [current, engine] = await Promise.all([org.view(session.userId), org.engine()]);
      if (!current) return json({ error: "sign in with Cloudflare first" }, 401);
      if (current.personal && !engine) return json({ error: "chef is not set up in Personal, so there is nothing to uninstall" }, 400);
      const confirm = ((await request.json().catch(() => null)) as { confirm?: unknown } | null)?.confirm;
      if (typeof confirm !== "string" || confirm.trim() !== current.name) return json({ error: `type ${current.name} to confirm` }, 400);
      const started = await member.remove({ orgId: session.orgId, orgName: current.name, personal: current.personal, engine, projects: engine ? await engineProjects(engine) : null });
      return typeof started === "string" ? json({ error: started }, 409) : json(started, 202);
    }
    if (path === "/site/api/remove" && request.method === "DELETE") {
      await member.dismissRemoval();
      return json({ ok: true });
    }
    if (path === "/site/api/orgs" && request.method === "GET") return json({ current: session.orgId, orgs: await directory(env).orgs(session.userId) });
    if (path === "/site/api/orgs" && request.method === "POST") {
      const name = readOrgName(await request.json().catch(() => null));
      if (!name) return json({ error: "give the organization a name of up to 60 characters" }, 400);
      const created = await directory(env).createOrg(session.userId, name);
      const view = await member.view(session.orgId);
      await organization(env, created.id).setup({ id: created.id, name, personal: false }, { userId: session.userId, email: view.email, role: "owner" });
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
      if ((await org.view(session.userId))?.personal) return json({ error: "your personal workspace keeps its name" }, 400);
      const name = readOrgName(await request.json().catch(() => null));
      if (!name) return json({ error: "give the organization a name of up to 60 characters" }, 400);
      await org.rename(name);
      await directory(env).renameOrg(session.orgId, name);
      return json({ org: await org.view(session.userId) });
    }
    if (path === "/site/api/org/members" && request.method === "GET") return json({ members: await org.members(), invites: can(role, "members") ? await directory(env).invites(session.orgId) : [] });
    if (path === "/site/api/org/members" && request.method === "POST") {
      if (!can(role, "members")) return json({ error: "only owners and admins can invite people" }, 403);
      if ((await org.view(session.userId))?.personal) return json({ error: "Personal is yours alone; create an organization to work with others" }, 400);
      const body = (await request.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
      const email = readEmail(body?.email);
      const invitedRole = body?.role ?? "member";
      if (!email) return json({ error: "give an email address" }, 400);
      if (!isRole(invitedRole) || (invitedRole === "owner" && role !== "owner")) return json({ error: "only owners can invite owners" }, 403);
      const invited = await directory(env).invite(session.orgId, email, invitedRole, session.userId);
      if (invited.status === "member") return json({ error: `${email} is already a member` }, 409);
      if (invited.status === "added") await org.setup({ id: session.orgId, name: "", personal: false }, { userId: invited.userId, email, role: invitedRole });
      return json({ status: invited.status, members: await org.members(), invites: await directory(env).invites(session.orgId) }, 201);
    }
    const person = /^\/site\/api\/org\/members\/(usr_[A-Za-z0-9]{20})$/.exec(path)?.[1];
    if (person && (request.method === "PATCH" || request.method === "DELETE")) {
      if (!can(role, "members")) return json({ error: "only owners and admins can change members" }, 403);
      const target = (await org.members()).find((m) => m.userId === person);
      if (!target) return json({ error: "that person is not a member" }, 404);
      if (role !== "owner" && target.role === "owner") return json({ error: "only owners can change owners" }, 403);
      if (request.method === "DELETE") {
        if (!(await org.removeMember(person))) return json({ error: "an organization keeps at least one owner" }, 409);
        await directory(env).removeMember(session.orgId, person);
      } else {
        const next = ((await request.json().catch(() => null)) as { role?: unknown } | null)?.role;
        if (!isRole(next) || (next === "owner" && role !== "owner")) return json({ error: "only owners can make owners" }, 403);
        if (!(await org.setRole(person, next))) return json({ error: "an organization keeps at least one owner" }, 409);
        await directory(env).setRole(session.orgId, person, next);
      }
      return json({ members: await org.members() });
    }
    const invite = /^\/site\/api\/org\/invites\/([^/]+)$/.exec(path)?.[1];
    if (invite && request.method === "DELETE") {
      if (!can(role, "members")) return json({ error: "only owners and admins can change invitations" }, 403);
      await directory(env).cancelInvite(session.orgId, decodeURIComponent(invite).toLowerCase());
      return json({ invites: await directory(env).invites(session.orgId) });
    }
    const shared = /^\/site\/api\/projects\/([a-z][a-z0-9-]{1,30})\/access(?:\/(usr_[A-Za-z0-9]{20}))?$/.exec(path);
    if (shared) {
      const name = shared[1] as string;
      const level = (await org.access(session.userId, name))?.level ?? null;
      if (!level) return json({ error: `there is no project named ${name}` }, 404);
      if (request.method === "GET") return json({ you: level, ...(atLeast(level, "manage") ? { sharing: await org.sharing(name), members: await org.members() } : {}) });
      if (!atLeast(level, "manage")) return json({ error: "only people who manage this project can share it" }, 403);
      const body = (await request.json().catch(() => null)) as { visibility?: unknown; orgLevel?: unknown; level?: unknown } | null;
      if (shared[2]) {
        if (request.method !== "PUT" && request.method !== "DELETE") return json({ error: "method not allowed" }, 405);
        const next = request.method === "DELETE" ? null : body?.level;
        if (next !== null && !isLevel(next)) return json({ error: "pick view, edit or manage" }, 400);
        const sharing = await org.setLevel(session.userId, name, shared[2], next);
        return sharing ? json({ you: level, sharing, members: await org.members() }) : json({ error: "that person is not in this organization" }, 404);
      }
      if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);
      if ((body?.visibility !== "private" && body?.visibility !== "org") || !isLevel(body.orgLevel) || body.orgLevel === "manage") return json({ error: "pick private, or the whole organization with view or edit" }, 400);
      return json({ you: level, sharing: await org.share(session.userId, name, body.visibility, body.orgLevel), members: await org.members() });
    }
    return json({ error: "not found" }, 404);
  }

  if (path === "/api/app" && request.method === "GET" && session && org && member && (await access())) {
    const [view, current, orgs] = await Promise.all([member.view(session.orgId), org.view(session.userId), directory(env).orgs(session.userId)]);
    return json({ engine: url.origin, account: view.email, org: current, orgs, ...(view.admin ? { admin: true } : {}) });
  }

  if (ENGINE_PATH.test(path)) {
    if (!sameSite) return json({ error: "cross-site request refused" }, 403);
    const rule = engineRule(request.method, url);
    const signedIn = session && org ? await org.access(session.userId, rule.kind === "project" ? rule.project : null).catch(() => null) : null;
    if (!session || !org || !signedIn?.engine) return json({ error: signedIn ? "chef is not set up for this organization yet" : "sign in with Cloudflare first" }, 401);
    if (rule.kind === "admin" && !can(signedIn.role, "setup")) return json({ error: "only owners and admins can change settings for the whole organization" }, 403);
    if (rule.kind === "project" && !signedIn.level) return json({ error: `there is no project named ${rule.project}` }, 404);
    if (rule.kind === "project" && !atLeast(signedIn.level, rule.need)) return json({ error: rule.need === "manage" ? "only people who manage this project can change its settings" : "you can view this project but not change it" }, 403);
    if (rule.kind === "create") {
      const body = await request.text();
      const name = (readJson(body) as { name?: unknown } | null)?.name;
      if (typeof name === "string" && !(await org.claimProject(session.userId, name.trim()))) return json({ error: `there is already a project named ${name.trim()}` }, 409);
      return proxy(new Request(request, { body }), signedIn.engine, url.origin, fetch, session.userId);
    }
    const response = await proxy(request, signedIn.engine, url.origin, fetch, session.userId);
    if (rule.kind !== "list" || !response.ok) return response;
    const listed = (await response.json()) as { projects: readonly { name: string }[] };
    const levels = await org.levels(session.userId, listed.projects.map((p) => p.name));
    return json({ projects: listed.projects.flatMap((p) => (levels[p.name] ? [{ ...p, access: levels[p.name] }] : [])) });
  }

  if (path === "/" || path === "/index.html") {
    const signedIn = await access();
    if (!signedIn) return page(env, request, "/");
    return signedIn.engine ? page(env, request, "/app") : redirect("/setup");
  }

  if (path === "/setup") return (await access()) ? page(env, request, "/setup") : redirect("/");
  if (path === "/remove") return (await access()) ? page(env, request, "/remove") : redirect("/");
  if (path === "/backoffice") {
    if (!session || !member || !env.BACKOFFICE_URL || !(await access()) || !(await member.admin())) return redirect("/");
    return redirect(`${env.BACKOFFICE_URL}/auth/callback?ticket=${session.userId}.${await member.backofficeTicket()}`);
  }
  if (path === "/app" || path === "/app.html") return redirect("/");

  return env.ASSETS.fetch(request);
}
