import type { FeatureSpec } from "../spec/schema.ts";

export const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export const RESERVED_ENV_NAMES: ReadonlySet<string> = new Set(["STORE", "ASSETS"]);

export interface EnvVar {
  readonly name: string;
  readonly secret: boolean;
}

export interface EnvNeed {
  readonly name: string;
  readonly features: readonly string[];
}

export function envProblem(name: string): string | null {
  if (!ENV_NAME.test(name)) return `${name || "(empty)"} is not a valid name: use capital letters, digits and _ and start with a letter, like STRIPE_SECRET_KEY`;
  if (RESERVED_ENV_NAMES.has(name)) return `${name} is used by the app itself; pick another name`;
  return null;
}

export function missingEnv(feature: Pick<FeatureSpec, "env">, configured: readonly EnvVar[]): string[] {
  const have = new Set(configured.map((v) => v.name));
  return feature.env.filter((name) => !have.has(name));
}

export function envNeeds(features: readonly Pick<FeatureSpec, "id" | "env">[], configured: readonly EnvVar[]): EnvNeed[] {
  const have = new Set(configured.map((v) => v.name));
  const needs = new Map<string, string[]>();
  for (const feature of features) for (const name of feature.env) if (!have.has(name)) needs.set(name, [...(needs.get(name) ?? []), feature.id].filter((id, i, all) => all.indexOf(id) === i));
  return [...needs].map(([name, ids]) => ({ name, features: ids })).sort((a, b) => a.name.localeCompare(b.name));
}

export function renderEnvironment(configured: readonly EnvVar[], feature: Pick<FeatureSpec, "env">): string | null {
  if (configured.length === 0 && feature.env.length === 0) return null;
  const missing = missingEnv(feature, configured);
  const lines = [
    "Environment: keys and settings reach the app at runtime as strings in `context.env` (for example `context.env.STRIPE_SECRET_KEY`). You never see their values. Never hard-code a key or put one in a file; in tests pass fake values through `createApp(features, store, { NAME: \"test\" })` and never call the real service from a test.",
  ];
  if (configured.length) lines.push(`Set in this project: ${configured.map((v) => `${v.name}${v.secret ? " (secret)" : ""}`).join(", ")}.`);
  if (feature.env.length) lines.push(`This feature uses: ${feature.env.join(", ")}.${missing.length ? ` Not set yet: ${missing.join(", ")}; the person will add them before the app is checked, so write the code as if they exist and answer with a clear error when one is empty.` : ""}`);
  return lines.join("\n");
}

export function parseDotEnv(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = (match[2] ?? "").trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    if (quote === '"') value = value.replace(/\\n/g, "\n");
    vars[match[1] as string] = value;
  }
  return vars;
}
