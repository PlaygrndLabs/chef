export const DASH = "https://dash.cloudflare.com";
export const API = "https://api.cloudflare.com/client/v4";

export const OAUTH_COOKIE = "chef_oauth";
export const SESSION_COOKIE = "chef_session";
export const SESSION_SECONDS = 30 * 24 * 3600;
export const GRANT_SECONDS = 3600;

export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: string;
}

export interface Pending {
  readonly state: string;
  readonly verifier: string;
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function challengeFor(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export async function authorizeUrl(client: OAuthClient, redirectUri: string, pending: Pending): Promise<string> {
  const url = new URL(`${DASH}/oauth2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", client.scopes);
  url.searchParams.set("state", pending.state);
  url.searchParams.set("code_challenge", await challengeFor(pending.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function tokenRequest(client: OAuthClient, form: Readonly<Record<string, string>>): Request {
  return new Request(`${DASH}/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
}

export function revokeRequest(client: OAuthClient, token: string): Request {
  return new Request(`${DASH}/oauth2/revoke`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, token_type_hint: "access_token" }).toString(),
  });
}

export interface Granted {
  readonly token: string;
  readonly expiresAt: number;
}

export function readGrant(body: unknown, now: number): Granted | null {
  const input = (body ?? {}) as { access_token?: unknown; expires_in?: unknown };
  if (typeof input.access_token !== "string" || !input.access_token) return null;
  const seconds = typeof input.expires_in === "number" && input.expires_in > 0 ? Math.min(input.expires_in, GRANT_SECONDS) : GRANT_SECONDS;
  return { token: input.access_token, expiresAt: now + seconds * 1000 };
}

export function cookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

export function setCookie(name: string, value: string, maxAge: number, path = "/"): string {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function encodePending(pending: Pending): string {
  return `${pending.state}.${pending.verifier}`;
}

export function decodePending(value: string | undefined): Pending | null {
  const [state, verifier] = (value ?? "").split(".");
  return state && verifier ? { state, verifier } : null;
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`chef session ${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))));
}

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function signSession(secret: string, userId: string, now: number): Promise<string> {
  const body = `${userId}.${Math.floor(now / 1000) + SESSION_SECONDS}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function readSession(secret: string, value: string | undefined, now: number): Promise<string | null> {
  const [userId, expires, signature] = (value ?? "").split(".");
  if (!userId || !expires || !signature || !USER_ID.test(userId)) return null;
  if (Number(expires) * 1000 <= now) return null;
  const expected = await hmac(secret, `${userId}.${expires}`);
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0 ? userId : null;
}

export interface Profile {
  readonly id: string;
  readonly email: string | null;
}

export function readProfile(body: unknown): Profile | null {
  const result = ((body ?? {}) as { result?: { id?: unknown; email?: unknown } }).result;
  if (!result || typeof result.id !== "string" || !USER_ID.test(result.id)) return null;
  return { id: result.id, email: typeof result.email === "string" ? result.email : null };
}

export interface InstallRequest {
  readonly accountId: string;
}

export function readInstall(body: unknown): InstallRequest | string {
  const accountId = ((body ?? {}) as { accountId?: unknown }).accountId;
  return typeof accountId === "string" && /^[0-9a-f]{32}$/.test(accountId) ? { accountId } : "choose a Cloudflare account";
}

export type Plan = "paid" | "free" | "unknown";

export function planFrom(subscriptions: unknown): Plan {
  if (!Array.isArray(subscriptions)) return "unknown";
  const text = subscriptions.map((s) => JSON.stringify(s).toLowerCase());
  if (text.some((t) => t.includes("workers") && /paid|standard|bundled|unbound/.test(t) && !t.includes('"state":"cancelled"'))) return "paid";
  return text.length > 0 ? "free" : "unknown";
}
