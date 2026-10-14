import type { Env } from "./env.ts";
import { COOKIE, readCookie, readSession, SESSION_SECONDS, setCookie, signSession } from "./session.ts";

const ORG = "org_[A-Za-z0-9]{20}";
const USR = "usr_[A-Za-z0-9]{20}";
const OPEN = new Set(["/style.css", "/favicon.svg", "/chef-logo.svg", "/chef-logo-dark.svg"]);

const SECURITY: Record<string, string> = {
  "content-security-policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

function secure(response: Response, noStore = true): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY)) out.headers.set(name, value);
  if (noStore) out.headers.set("cache-control", "no-store");
  return out;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => secure(Response.json(body, { status, headers }));

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie) headers.append("set-cookie", cookie);
  return secure(new Response(null, { status: 302, headers }));
}

function refused(site: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>chef backoffice</title><link rel="stylesheet" href="/style.css"></head><body class="refused"><main><p class="label">Backoffice</p><h1>Only PlaygrndLabs admins can open the backoffice.</h1><p class="muted">Sign in with a Cloudflare login that can see the PlaygrndLabs account. If chef already has you signed in with another login, sign out of chef first.</p><p><a class="button" href="${site}">Back to chef</a></p></main></body></html>`;
  return secure(new Response(html, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } }));
}

const outcome = (value: unknown) => {
  const refusal = value as { error?: unknown; status?: unknown } | null;
  return typeof refusal?.error === "string" && typeof refusal.status === "number" ? json({ error: refusal.error }, refusal.status) : json(value);
};

async function body(request: Request): Promise<Record<string, unknown>> {
  const read = (await request.json().catch(() => null)) as unknown;
  return read && typeof read === "object" ? (read as Record<string, unknown>) : {};
}

async function api(request: Request, env: Env, adminId: string, path: string): Promise<Response> {
  const method = request.method;
  if (path === "/api/me" && method === "GET") return outcome(await env.SITE.me(adminId));
  if (path === "/api/directory" && method === "GET") return outcome(await env.SITE.directory(adminId));
  const person = new RegExp(`^/api/people/(${USR})$`).exec(path)?.[1];
  if (person && method === "GET") return outcome(await env.SITE.person(adminId, person));
  const org = new RegExp(`^/api/orgs/(${ORG})(/.*)?$`).exec(path);
  if (!org) return json({ error: "not found" }, 404);
  const orgId = org[1] as string;
  const rest = org[2] ?? "";
  if (rest === "" && method === "GET") return outcome(await env.SITE.org(adminId, orgId));
  if (rest === "" && method === "PATCH") return outcome(await env.SITE.renameOrg(adminId, orgId, (await body(request))["name"]));
  if (rest === "/budget" && method === "PUT") return outcome(await env.SITE.setBudget(adminId, orgId, (await body(request))["dollars"] ?? null));
  const member = new RegExp(`^/members/(${USR})$`).exec(rest)?.[1];
  if (member && method === "PATCH") return outcome(await env.SITE.setRole(adminId, orgId, member, (await body(request))["role"]));
  if (member && method === "DELETE") return outcome(await env.SITE.removeMember(adminId, orgId, member));
  const invite = /^\/invites\/([^/]+)$/.exec(rest)?.[1];
  if (invite && method === "DELETE") return outcome(await env.SITE.cancelInvite(adminId, orgId, decodeURIComponent(invite)));
  return json({ error: "not found" }, 404);
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const secret = env.SESSION_SECRET;
  if (!secret) return secure(new Response("The backoffice has no session key yet.", { status: 503 }));

  if (path === "/auth/start") return redirect(`${env.SITE_URL}/backoffice`);

  if (path === "/auth/callback") {
    const admin = await env.SITE.redeem(url.searchParams.get("ticket") ?? "").catch(() => null);
    if (!admin) return refused(env.SITE_URL);
    return redirect("/", setCookie(await signSession(secret, admin.userId, Date.now()), SESSION_SECONDS));
  }

  if (path === "/auth/signout") {
    if (request.method !== "POST" || request.headers.get("origin") !== url.origin) return json({ error: "sign out from the backoffice menu" }, 405);
    return json({ ok: true, site: env.SITE_URL }, 200, { "set-cookie": setCookie("", 0) });
  }

  const adminId = await readSession(secret, readCookie(request.headers.get("cookie"), COOKIE), Date.now());

  if (path.startsWith("/api/")) {
    if (!adminId) return json({ error: "sign in again" }, 401);
    if (request.method !== "GET" && request.headers.get("origin") !== url.origin) return json({ error: "cross-site request refused" }, 403);
    try {
      return await api(request, env, adminId, path);
    } catch {
      return json({ error: "chef did not answer. Try again in a moment." }, 502);
    }
  }

  if (!adminId && !OPEN.has(path)) return request.method === "GET" || request.method === "HEAD" ? redirect("/auth/start") : json({ error: "sign in again" }, 401);
  const asset = await env.ASSETS.fetch(request);
  return secure(asset, (asset.headers.get("content-type") ?? "").startsWith("text/html"));
}
