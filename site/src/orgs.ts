export type Role = "owner" | "admin" | "member";

export const ROLES: readonly Role[] = ["owner", "admin", "member"];

export interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}

export type Action = "use" | "setup" | "rename" | "manage";

const ALLOWED: Readonly<Record<Action, readonly Role[]>> = {
  use: ["owner", "admin", "member"],
  setup: ["owner", "admin"],
  rename: ["owner", "admin"],
  manage: ["owner"],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return role !== null && role !== undefined && ALLOWED[action].includes(role);
}

const ID = /^(usr|org)_[A-Za-z0-9]{20}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function newId(prefix: "usr" | "org"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function isId(value: unknown, prefix: "usr" | "org"): value is string {
  return typeof value === "string" && ID.test(value) && value.startsWith(`${prefix}_`);
}

export function defaultOrgName(email: string | null): string {
  const local = (email ?? "").split("@")[0]?.trim();
  return local ? `${local}'s org` : "My org";
}

export function readOrgName(body: unknown): string | null {
  const name = ((body ?? {}) as { name?: unknown }).name;
  if (typeof name !== "string") return null;
  const trimmed = name.replace(/\s+/g, " ").trim();
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
}
