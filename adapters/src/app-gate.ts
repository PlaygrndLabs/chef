export const APP_KEY_VAR = "CHEF_APP_KEY";
export const APP_TARGET_VAR = "CHEF_TARGET";
export const APP_ENTER_PATH = "/__chef/enter";
export const APP_REQUEST_HEADER = "x-chef-app";
export const ROUTER_MODULE = "router.mjs";

const ENTER_SECONDS = 120;
export const OWNER_COOKIE_SECONDS = 12 * 60 * 60;
export const SHARE_COOKIE_SECONDS = 60 * 60;

export interface PassClaim {
  readonly use: "enter" | "cookie";
  readonly host: string;
  readonly expiresAt: number;
  readonly cookieSeconds?: number;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newAppKey(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function signAppPass(key: string, claim: PassClaim): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ u: claim.use, h: claim.host, e: claim.expiresAt, ...(claim.cookieSeconds ? { c: claim.cookieSeconds } : {}) })));
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${base64url(new Uint8Array(await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(payload))))}`;
}

export async function appEntry(url: string, key: string, input: { readonly path: string; readonly now: number; readonly cookieSeconds?: number }): Promise<string> {
  const origin = new URL(url);
  const token = await signAppPass(key, { use: "enter", host: origin.hostname, expiresAt: input.now + ENTER_SECONDS * 1000, cookieSeconds: input.cookieSeconds ?? OWNER_COOKIE_SECONDS });
  return `${origin.origin}${APP_ENTER_PATH}?t=${token}&to=${encodeURIComponent(input.path || "/")}`;
}

export function routerModule(): string {
  return ROUTER;
}

const ROUTER = String.raw`
const KEY = "CHEF_APP_KEY";
const ENTER = "/__chef/enter";
const COOKIE = "__Host-chef_app";
const encoder = new TextEncoder();
const keys = new Map();

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function hmac(secret) {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, key);
  }
  return key;
}

async function sign(secret, claim) {
  const payload = base64url(encoder.encode(JSON.stringify(claim)));
  return payload + "." + base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmac(secret), encoder.encode(payload))));
}

async function check(secret, token, use, host, now) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    if (!(await crypto.subtle.verify("HMAC", await hmac(secret), unbase64url(signature), encoder.encode(payload)))) return null;
    const claim = JSON.parse(new TextDecoder().decode(unbase64url(payload)));
    return claim && claim.u === use && claim.h === host && typeof claim.e === "number" && claim.e > now ? claim : null;
  } catch {
    return null;
  }
}

function cookies(request) {
  const all = (request.headers.get("cookie") || "").split(";").map((c) => c.trim()).filter(Boolean);
  const mine = all.find((c) => c.startsWith(COOKIE + "="));
  return { value: mine ? mine.slice(COOKIE.length + 1) : null, rest: all.filter((c) => c !== mine).join("; ") };
}

function safePath(raw) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !/[\s\\]/.test(raw) ? raw : "/";
}

function closed(request, status, title, detail) {
  const headers = { "cache-control": "no-store" };
  if (!(request.headers.get("accept") || "").includes("text/html")) return Response.json({ error: detail }, { status, headers });
  const html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>" + title + "</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fafafa;color:#18181b}main{max-width:32rem;padding:24px}h1{font-size:18px}@media (prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}}</style></head><body><main><h1>" + title + "</h1><p>" + detail + "</p></main></body></html>";
  return new Response(html, { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

async function gate(request, env, next) {
  const secret = env && env[KEY];
  if (typeof secret !== "string" || secret.length < 32) return closed(request, 503, "This app is not ready", "Chef has not finished setting up this address. Open the app again from Chef.");
  const url = new URL(request.url);
  const now = Date.now();
  if (url.pathname === ENTER) {
    const claim = await check(secret, url.searchParams.get("t"), "enter", url.hostname, now);
    if (!claim) return closed(request, 401, "This link has expired", "Links into an app work for a short time only. Open the app again from Chef.");
    const seconds = Math.min(86400, Math.max(60, typeof claim.c === "number" ? Math.floor(claim.c) : 3600));
    const value = await sign(secret, { u: "cookie", h: url.hostname, e: now + seconds * 1000 });
    const headers = new Headers({ location: safePath(url.searchParams.get("to")), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    headers.append("set-cookie", COOKIE + "=" + value + "; Path=/; Max-Age=" + seconds + "; HttpOnly; Secure; SameSite=None; Partitioned");
    return new Response(null, { status: 302, headers });
  }
  const jar = cookies(request);
  if (!(await check(secret, jar.value, "cookie", url.hostname, now))) return closed(request, 401, "Open this app from Chef", "Apps Chef is building are private. Open this one from its project in Chef, or from a link someone shared with you.");
  const headers = new Headers(request.headers);
  if (jar.rest) headers.set("cookie", jar.rest);
  else headers.delete("cookie");
  headers.set("x-chef-app", "1");
  return next(new Request(request, { headers }));
}

export default {
  fetch(request, env) {
    return gate(request, env, (forwarded) => env.SESSION.get(env.SESSION.idFromName(env.CHEF_TARGET)).fetch(forwarded));
  },
};
`;
