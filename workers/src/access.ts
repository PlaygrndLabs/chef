import { faviconDataUri, wordmarkSvg } from "@chef/core/brand";
import { tokenHash, tokenId } from "@chef/core/access";
import { deploymentGrant, live, type Grant } from "./grants.ts";

export const USER_HEADER = "x-chef-user";
export const ORIGIN_HEADER = "x-chef-origin";
const ACTS_FOR_PEOPLE = [USER_HEADER, ORIGIN_HEADER];

const COOKIE = "chef_access";
const ITERATIONS = 100_000;
export const MIN_PASSWORD = 8;
export const EXAMPLE_PASSWORD = "change-me-to-a-long-random-password";

export function deploymentPassword(env: { readonly CHEF_PASSWORD?: string }): string | null {
  const password = env.CHEF_PASSWORD?.trim();
  return password && password !== EXAMPLE_PASSWORD ? password : null;
}

export function homeOrigin(env: { readonly CHEF_HOME?: string }): string | null {
  try {
    const url = new URL(env.CHEF_HOME?.trim() ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export interface StoredPassword {
  readonly salt: string;
  readonly hash: string;
}

export type Credential = { readonly kind: "deployment"; readonly password: string } | ({ readonly kind: "app" } & StoredPassword);

export type Caller = { readonly kind: "browser" } | { readonly kind: "grant"; readonly grant: Grant };

export interface Access {
  readonly password: () => Promise<Credential | null>;
  readonly deploymentKey: string | null;
  readonly sealed: () => Promise<boolean>;
  readonly grant: (id: string) => Promise<Grant | null>;
  readonly claim: (password: StoredPassword) => Promise<boolean>;
  readonly used: (grant: Grant) => void;
  readonly home: string | null;
  readonly now?: () => number;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (text: string) => new Uint8Array((text.match(/../g) ?? []).map((pair) => parseInt(pair, 16)));

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256)));
}

export async function hashPassword(password: string): Promise<StoredPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: hex(salt), hash: await pbkdf2(password, salt) };
}

function material(credential: Credential): string {
  return credential.kind === "deployment" ? credential.password : credential.hash;
}

async function sessionToken(credential: Credential): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(material(credential)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("chef dashboard session"))));
}

export async function sessionCookie(credential: Credential): Promise<string> {
  return `${COOKIE}=${await sessionToken(credential)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const verified = new Map<string, string>();

async function matches(password: string, credential: Credential): Promise<boolean> {
  if (!password) return false;
  if (credential.kind === "deployment") return same(password, credential.password);
  const cacheKey = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${credential.salt}:${password}`))));
  if (verified.get(cacheKey) === credential.hash) return true;
  const ok = same(await pbkdf2(password, unhex(credential.salt)), credential.hash);
  if (ok) verified.set(cacheKey, credential.hash);
  return ok;
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

const STYLE = `<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f6f4;color:#1d1d1b}form{display:grid;gap:12px;width:min(320px,90vw)}h1{margin:0 0 12px;display:flex;justify-content:center}h1 svg{height:42px;width:auto}p{margin:0}input,button{font:inherit;padding:10px;border-radius:0;border:1px solid #c9c9c4}button{background:#1d1d1b;color:#fff;border:0}.note{color:#6b6b66;font-size:14px}.error{color:#b42318}@media (prefers-color-scheme:dark){body{background:#151514;color:#eee}input{background:#222;color:#eee;border-color:#444}button{background:#eee;color:#151514}.note{color:#a3a39e}}</style>`;

function page(body: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chef</title><link rel="icon" href="${faviconDataUri()}">${STYLE}</head><body>${body}</body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function loginPage(failed: boolean): Response {
  const note = failed ? `<p class="error">Wrong password.</p>` : "";
  return page(`<form method="post" action="/login"><h1>${wordmarkSvg()}</h1>${note}<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required><button>Sign in</button></form>`, failed ? 401 : 200);
}

function setupPage(error: string | null): Response {
  const note = error ? `<p class="error">${error}</p>` : "";
  return page(
    `<form method="post" action="/setup"><h1>Welcome to chef</h1><p class="note">Pick a password for this chef. You will use it to sign in. Scripts use API keys, which you make in Settings.</p>${note}<input type="password" name="password" placeholder="Password, at least ${MIN_PASSWORD} characters" autocomplete="new-password" minlength="${MIN_PASSWORD}" autofocus required><input type="password" name="confirm" placeholder="The same password again" autocomplete="new-password" required><button>Set the password</button></form>`,
    error ? 400 : 200,
  );
}

export function passwordProblem(password: string, confirm: string | null = password): string | null {
  if (password.length < MIN_PASSWORD) return `The password needs at least ${MIN_PASSWORD} characters.`;
  if (confirm !== password) return "The two passwords differ.";
  return null;
}

function closedPage(): Response {
  return page(`<form><h1>${wordmarkSvg()}</h1><p class="note">This Chef has no password, so it opens only through the app that manages it.</p></form>`, 403);
}

async function keyGrant(token: string, access: Access): Promise<Grant | null> {
  if (access.deploymentKey && same(token, access.deploymentKey)) return deploymentGrant(token);
  const id = tokenId(token);
  const grant = id ? await access.grant(id) : null;
  if (!grant || !live(grant, (access.now ?? Date.now)())) return null;
  return same(await tokenHash(token), grant.hash) ? grant : null;
}

export async function guard(request: Request, access: Access): Promise<Response | Caller> {
  const url = new URL(request.url);
  const api = url.pathname.startsWith("/api/") || url.pathname.startsWith("/agents/");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (bearer && tokenId(bearer)) {
    const grant = await keyGrant(bearer, access);
    if (!grant) return Response.json({ error: "this API key is not valid: it was revoked, ran out or never existed" }, { status: 401 });
    access.used(grant);
    return { kind: "grant", grant };
  }
  const refused = bearer ? "a password only signs in from a browser; scripts send an API key from Settings, API keys" : "sign in first";
  const credential = await access.password();
  if (!credential) {
    if (access.deploymentKey || (await access.sealed())) {
      if (api) return Response.json({ error: access.home ? `open Chef at ${access.home}` : "this Chef answers only API keys" }, { status: 401 });
      return access.home ? new Response(null, { status: 302, headers: { location: access.home, "cache-control": "no-store" } }) : closedPage();
    }
    if (url.pathname === "/setup" && request.method === "POST") {
      const form = await request.formData();
      const password = String(form.get("password") ?? "");
      const problem = passwordProblem(password, String(form.get("confirm") ?? ""));
      if (problem) return setupPage(problem);
      const stored = await hashPassword(password);
      if (!(await access.claim(stored))) return new Response(null, { status: 303, headers: { location: "/" } });
      return new Response(null, { status: 303, headers: { location: "/", "set-cookie": await sessionCookie({ kind: "app", ...stored }) } });
    }
    return api ? Response.json({ error: "Chef has no password yet: open it in a browser to set one" }, { status: 503 }) : setupPage(null);
  }
  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    if (!(await matches(String(form.get("password") ?? ""), credential))) return loginPage(true);
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": await sessionCookie(credential) } });
  }
  if (same(cookie(request, COOKIE) ?? "", await sessionToken(credential))) return { kind: "browser" };
  return api ? Response.json({ error: refused }, { status: 401 }) : loginPage(false);
}

export function trusted(request: Request, caller: Caller | null): Request {
  if (caller?.kind === "grant" && caller.grant.kind === "controller") return request;
  if (!ACTS_FOR_PEOPLE.some((name) => request.headers.has(name))) return request;
  const headers = new Headers(request.headers);
  for (const name of ACTS_FOR_PEOPLE) headers.delete(name);
  return new Request(request, { headers });
}
