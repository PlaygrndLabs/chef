import type { Tree } from "@chef/core";

export const PREVIEW_KEY_VAR = "CHEF_PREVIEW_KEY";
export const PREVIEW_PASS_HEADER = "x-chef-preview-pass";
export const PREVIEW_ENTER_PATH = "/__chef/enter";
export const PREVIEW_GATE_FILE = ".chef/preview-gate.mjs";

const ENTER_SECONDS = 120;
const PASS_SECONDS = 20 * 60;
export const OWNER_COOKIE_SECONDS = 12 * 60 * 60;

export type PassUse = "enter" | "pass" | "cookie";

export interface PassClaim {
  readonly use: PassUse;
  readonly host: string;
  readonly expiresAt: number;
  readonly cookieSeconds?: number;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newPreviewKey(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function signPreviewPass(key: string, claim: PassClaim): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ u: claim.use, h: claim.host, e: claim.expiresAt, ...(claim.cookieSeconds ? { c: claim.cookieSeconds } : {}) })));
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${base64url(new Uint8Array(await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(payload))))}`;
}

export async function previewEntry(url: string, key: string, input: { readonly path: string; readonly now: number; readonly cookieSeconds?: number }): Promise<string> {
  const origin = new URL(url);
  const token = await signPreviewPass(key, { use: "enter", host: origin.hostname, expiresAt: input.now + ENTER_SECONDS * 1000, cookieSeconds: input.cookieSeconds ?? OWNER_COOKIE_SECONDS });
  return `${origin.origin}${PREVIEW_ENTER_PATH}?t=${token}&to=${encodeURIComponent(input.path || "/")}`;
}

export async function previewPass(url: string, key: string, now: number): Promise<{ readonly host: string; readonly token: string }> {
  const host = new URL(url).hostname;
  return { host, token: await signPreviewPass(key, { use: "pass", host, expiresAt: now + PASS_SECONDS * 1000 }) };
}

export function previewMain(tree: Tree): string {
  for (const file of ["wrangler.jsonc", "wrangler.json"]) {
    const main = tree[file] === undefined ? null : /"main"\s*:\s*"([^"]+)"/.exec(tree[file] as string)?.[1];
    if (main) return main;
  }
  return /^\s*main\s*=\s*"([^"]+)"/m.exec(tree["wrangler.toml"] ?? "")?.[1] ?? "src/index.ts";
}

export function gateModule(main: string): string {
  const app = JSON.stringify(`../${main.replace(/^\.\//, "")}`);
  return `import * as app from ${app};\nexport * from ${app};\n${GATE}`;
}

const GATE = String.raw`
const KEY = "CHEF_PREVIEW_KEY";
const PASS = "x-chef-preview-pass";
const ENTER = "/__chef/enter";
const COOKIE = "__Host-chef_preview";
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
  if (typeof secret !== "string" || secret.length < 32) return closed(request, 503, "This preview is not ready", "Chef has not finished setting up this preview. Open it again from Chef.");
  const url = new URL(request.url);
  const now = Date.now();
  if (url.pathname === ENTER) {
    const claim = await check(secret, url.searchParams.get("t"), "enter", url.hostname, now);
    if (!claim) return closed(request, 401, "This link has expired", "Links into a preview work for a short time only. Open the preview again from Chef.");
    const seconds = Math.min(86400, Math.max(60, typeof claim.c === "number" ? Math.floor(claim.c) : 3600));
    const value = await sign(secret, { u: "cookie", h: url.hostname, e: now + seconds * 1000 });
    const headers = new Headers({ location: safePath(url.searchParams.get("to")), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    headers.append("set-cookie", COOKIE + "=" + value + "; Path=/; Max-Age=" + seconds + "; HttpOnly; Secure; SameSite=None; Partitioned");
    return new Response(null, { status: 302, headers });
  }
  const jar = cookies(request);
  const pass = request.headers.get(PASS);
  const allowed = (pass && (await check(secret, pass, "pass", url.hostname, now))) || (await check(secret, jar.value, "cookie", url.hostname, now));
  if (!allowed) return closed(request, 401, "Open this preview from Chef", "Previews are private. Open this one from its project in Chef, or from a link someone shared with you.");
  const headers = new Headers(request.headers);
  headers.delete(PASS);
  if (jar.rest) headers.set("cookie", jar.rest);
  else headers.delete("cookie");
  return next(new Request(request, { headers }));
}

function hidden(env) {
  if (!env || typeof env !== "object") return env;
  const { [KEY]: _key, ...rest } = env;
  return rest;
}

const missing = () => new Response("not found", { status: 404 });
const inner = app.default;
let gated;
if (typeof inner === "function") {
  gated = class extends inner {
    fetch(request) {
      return gate(request, this.env, (r) => (super.fetch ? super.fetch(r) : missing()));
    }
  };
} else {
  const handlers = inner && typeof inner === "object" ? inner : {};
  gated = { ...handlers, fetch: (request, env, ctx) => gate(request, env, (r) => (handlers.fetch ? handlers.fetch(r, hidden(env), ctx) : missing())) };
}
export default gated;
`;
