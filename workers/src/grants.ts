import { newToken, tokenHash, tokenId, tokenPrefix } from "@chef/core/access";

export type GrantKind = "controller" | "key" | "share";
export const FULL_ACCESS = "*";
export const DEPLOYMENT_KEY_NAME = "Set at install";
const NAME_MAX = 60;
const DAY_MS = 24 * 60 * 60_000;

export interface Grant {
  readonly id: string;
  readonly kind: GrantKind;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly hash: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
}

export interface GrantView {
  readonly id: string;
  readonly prefix: string;
  readonly kind: GrantKind;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly source: "deployment" | "app";
  readonly createdAt: number | null;
  readonly expiresAt: number | null;
  readonly lastUsedAt: number | null;
}

export interface GrantRequest {
  readonly name: string;
  readonly kind: GrantKind;
  readonly expiresAt: number | null;
}

export function deploymentKey(env: { readonly CHEF_API_KEY?: string }): string | null {
  const key = env.CHEF_API_KEY?.trim() ?? "";
  return tokenId(key) ? key : null;
}

export async function deploymentGrant(key: string): Promise<Grant> {
  return { id: tokenId(key) ?? "", kind: "controller", name: DEPLOYMENT_KEY_NAME, scopes: [FULL_ACCESS], hash: await tokenHash(key), createdAt: 0, expiresAt: null };
}

export function allows(grant: Grant, scope: string): boolean {
  return grant.scopes.includes(FULL_ACCESS) || grant.scopes.includes(scope);
}

export function live(grant: Grant, now: number): boolean {
  return grant.expiresAt === null || grant.expiresAt > now;
}

export function readGrantRequest(body: unknown, now: number): GrantRequest | string {
  if (!body || typeof body !== "object") return "send the key's name";
  const input = body as Record<string, unknown>;
  const name = typeof input["name"] === "string" ? input["name"].trim() : "";
  if (!name) return "give the key a name";
  if (name.length > NAME_MAX) return `keep the name under ${NAME_MAX} characters`;
  const kind = input["kind"] ?? "key";
  if (kind !== "key" && kind !== "controller") return "the kind must be key or controller";
  const days = input["expiresInDays"] ?? null;
  if (days !== null && (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365)) return "a key can last from 1 to 365 days, or leave it without an end";
  return { name, kind, expiresAt: days === null ? null : now + days * DAY_MS };
}

export async function mintGrant(request: GrantRequest, now: number, scopes: readonly string[] = [FULL_ACCESS]): Promise<{ readonly grant: Grant; readonly token: string }> {
  const { id, token } = newToken();
  return { grant: { id, kind: request.kind, name: request.name, scopes, hash: await tokenHash(token), createdAt: now, expiresAt: request.expiresAt }, token };
}

export function viewGrant(grant: Grant, source: "deployment" | "app", lastUsedAt: number | null): GrantView {
  return {
    id: grant.id,
    prefix: tokenPrefix(grant.id),
    kind: grant.kind,
    name: grant.name,
    scopes: grant.scopes,
    source,
    createdAt: source === "deployment" ? null : grant.createdAt,
    expiresAt: grant.expiresAt,
    lastUsedAt,
  };
}
