export const TOKEN_PREFIX = "chef_";
const TOKEN = /^chef_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export interface NewToken {
  readonly id: string;
  readonly token: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newToken(): NewToken {
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
  return { id, token: `${TOKEN_PREFIX}${id}_${base64url(crypto.getRandomValues(new Uint8Array(32)))}` };
}

export function tokenId(token: string): string | null {
  return TOKEN.exec(token.trim())?.[1] ?? null;
}

export function tokenPrefix(id: string): string {
  return `${TOKEN_PREFIX}${id}_`;
}

export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.trim()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
