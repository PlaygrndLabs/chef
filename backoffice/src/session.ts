export const COOKIE = "__Host-chef_backoffice";
export const SESSION_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

const toBase64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const key = (secret: string) => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function signSession(secret: string, userId: string, now: number): Promise<string> {
  const body = `${userId}.${Math.floor(now / 1000) + SESSION_SECONDS}`;
  return `${body}.${toBase64url(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body)))}`;
}

export async function readSession(secret: string, value: string | undefined, now: number): Promise<string | null> {
  const match = /^(usr_[A-Za-z0-9]{20})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!match) return null;
  const [, userId, expiry, signature] = match as unknown as [string, string, string, string];
  const bytes = fromBase64url(signature);
  if (!bytes || Number(expiry) * 1000 <= now) return null;
  return (await crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(`${userId}.${expiry}`))) ? userId : null;
}

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export const setCookie = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
