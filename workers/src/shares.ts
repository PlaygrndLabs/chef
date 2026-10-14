import { allows, FULL_ACCESS, mintGrant, type Grant } from "./grants.ts";

export type ShareKind = "session" | "preview";

export interface ShareTarget {
  readonly kind: ShareKind;
  readonly project: string;
  readonly id: string;
}

export interface ShareRequest {
  readonly kind: ShareKind;
  readonly id: string;
  readonly expiresAt: number | null;
}

export interface ShareView extends ShareTarget {
  readonly shareId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly lastUsedAt: number | null;
}

export const SHARES_ROUTE = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/shares$/;
export const SHARE_ROUTE = /^\/api\/shares\/([a-z0-9]{12})$/;
export const OPEN_SHARE = "/api/share";
export const SHARE_HEADER = "x-chef-share";
export const SHARE_PAGE = "/s";

const PROJECT = "[a-z][a-z0-9-]{1,30}";
const SESSION_SCOPE = new RegExp(`^session:(${PROJECT})/([a-z0-9-]{1,40})$`);
const PREVIEW_SCOPE = new RegExp(`^preview:(${PROJECT})/([a-z0-9-]{1,80})$`);
const SESSION_READ = new RegExp(`^/api/projects/(${PROJECT})/sessions/([a-z0-9-]{1,40})(?:/(?:turns|changes))?$`);
const PREVIEW_READ = new RegExp(`^/preview/(${PROJECT})/([a-z0-9-]{1,80})/?$`);
const DAY_MS = 24 * 60 * 60_000;
export const DEFAULT_SHARE_DAYS = 30;

export function sessionScope(project: string, id: string): string {
  return `session:${project}/${id}`;
}

export function previewScope(project: string, key: string): string {
  return `preview:${project}/${key}`;
}

export function scopeFor(method: string, pathname: string): string | null {
  if (method !== "GET") return null;
  const session = SESSION_READ.exec(pathname);
  if (session) return sessionScope(session[1] as string, session[2] as string);
  const preview = PREVIEW_READ.exec(pathname);
  if (preview) return previewScope(preview[1] as string, preview[2] as string);
  return null;
}

export function limited(grant: Grant): boolean {
  return !grant.scopes.includes(FULL_ACCESS);
}

export function reaches(grant: Grant, method: string, pathname: string): boolean {
  const scope = scopeFor(method, pathname);
  return scope !== null && allows(grant, scope);
}

export function targetOf(grant: Grant): ShareTarget | null {
  for (const scope of grant.scopes) {
    const session = SESSION_SCOPE.exec(scope);
    if (session) return { kind: "session", project: session[1] as string, id: session[2] as string };
  }
  for (const scope of grant.scopes) {
    const preview = PREVIEW_SCOPE.exec(scope);
    if (preview) return { kind: "preview", project: preview[1] as string, id: preview[2] as string };
  }
  return null;
}

export function readShareRequest(body: unknown, now: number): ShareRequest | string {
  if (!body || typeof body !== "object") return "say what to share";
  const input = body as Record<string, unknown>;
  const kind = input["kind"];
  if (kind !== "session" && kind !== "preview") return "share a session or a preview";
  const id = typeof input["id"] === "string" ? input["id"] : "";
  if (!(kind === "session" ? /^[a-z0-9-]{1,40}$/ : /^[a-z0-9-]{1,80}$/).test(id)) return kind === "session" ? "name the session to share" : "name the preview to share";
  const days = input["expiresInDays"] === undefined ? DEFAULT_SHARE_DAYS : input["expiresInDays"];
  if (days !== null && (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365)) return "a link can last from 1 to 365 days, or leave it without an end";
  return { kind, id, expiresAt: days === null ? null : now + days * DAY_MS };
}

export async function mintShare(request: ShareRequest, target: { readonly name: string; readonly scopes: readonly string[] }, now: number): Promise<{ readonly grant: Grant; readonly token: string }> {
  return mintGrant({ name: target.name.slice(0, 60) || request.id, kind: "share", expiresAt: request.expiresAt }, now, target.scopes);
}

export function viewShare(grant: Grant, lastUsedAt: number | null): ShareView | null {
  const target = targetOf(grant);
  if (grant.kind !== "share" || !target) return null;
  return { ...target, shareId: grant.id, name: grant.name, createdAt: grant.createdAt, expiresAt: grant.expiresAt, lastUsedAt };
}
