export type Role = "owner" | "admin" | "member";

export const ROLES: readonly Role[] = ["owner", "admin", "member"];

export type OrgPlan = "free";

export const PERSONAL = "Personal";

export interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly personal: boolean;
  readonly plan: OrgPlan;
}

export type Action = "use" | "setup" | "rename" | "members" | "manage";

const ALLOWED: Readonly<Record<Action, readonly Role[]>> = {
  use: ["owner", "admin", "member"],
  setup: ["owner", "admin"],
  rename: ["owner", "admin"],
  members: ["owner", "admin"],
  manage: ["owner"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export type ProjectLevel = "view" | "edit" | "manage";

export const LEVELS: readonly ProjectLevel[] = ["view", "edit", "manage"];

export type Visibility = "private" | "org";

export function isLevel(value: unknown): value is ProjectLevel {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function atLeast(level: ProjectLevel | null | undefined, need: ProjectLevel): boolean {
  return level !== null && level !== undefined && LEVELS.indexOf(level) >= LEVELS.indexOf(need);
}

export function highest(...levels: readonly (ProjectLevel | null | undefined)[]): ProjectLevel | null {
  let best: ProjectLevel | null = null;
  for (const level of levels) if (level && !atLeast(best, level)) best = level;
  return best;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

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

export function engineLabel(org: { readonly name: string; readonly personal: boolean }, email: string | null): string {
  return org.personal ? (email ?? "").split("@")[0]?.trim() || "personal" : org.name;
}

const NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function engineName(orgName: string, taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 20).replace(/-+$/, "") || "org";
  for (;;) {
    let suffix = "";
    for (let i = 0; i < 4; i++) suffix += NAME_ALPHABET[Math.floor(random() * NAME_ALPHABET.length)];
    const name = `chef-${slug}-${suffix}`;
    if (!taken.has(name)) return name;
  }
}

export function readOrgName(body: unknown): string | null {
  const name = ((body ?? {}) as { name?: unknown }).name;
  if (typeof name !== "string") return null;
  const trimmed = name.replace(/\s+/g, " ").trim();
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
}
