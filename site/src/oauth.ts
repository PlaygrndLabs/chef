export const DASH = "https://dash.cloudflare.com";
export const API = "https://api.cloudflare.com/client/v4";

export const OAUTH_COOKIE = "chef_oauth";
export const SESSION_COOKIE = "chef_setup";
export const SESSION_SECONDS = 3600;

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
  const seconds = typeof input.expires_in === "number" && input.expires_in > 0 ? Math.min(input.expires_in, SESSION_SECONDS) : SESSION_SECONDS;
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

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

export function sessionId(value: string | undefined): string | null {
  return value && SESSION_ID.test(value) ? value : null;
}

export const WORKER_NAME = /^[a-z][a-z0-9-]{0,40}$/;

export interface InstallRequest {
  readonly accountId: string;
  readonly password: string | null;
  readonly name: string;
}

export function readInstall(body: unknown): InstallRequest | string {
  const input = (body ?? {}) as { accountId?: unknown; password?: unknown; name?: unknown };
  const accountId = typeof input.accountId === "string" ? input.accountId : "";
  if (!/^[0-9a-f]{32}$/.test(accountId)) return "choose a Cloudflare account";
  const name = typeof input.name === "string" && input.name ? input.name : "chef";
  if (!WORKER_NAME.test(name)) return "the name uses lowercase letters, digits and dashes";
  const password = typeof input.password === "string" && input.password ? input.password : null;
  if (password !== null && password.length < 8) return "use a password of at least 8 characters";
  return { accountId, password, name };
}

export type Plan = "paid" | "free" | "unknown";

export function planFrom(subscriptions: unknown): Plan {
  if (!Array.isArray(subscriptions)) return "unknown";
  const text = subscriptions.map((s) => JSON.stringify(s).toLowerCase());
  if (text.some((t) => t.includes("workers") && /paid|standard|bundled|unbound/.test(t) && !t.includes('"state":"cancelled"'))) return "paid";
  return text.length > 0 ? "free" : "unknown";
}
