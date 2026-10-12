import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { FeatureSpec } from "../spec/schema.ts";
import { matchesScope } from "../util/glob.ts";

export const AgentProfile = z.strictObject({
  role: z.string().regex(/^[a-z][a-z-]*$/),
  model: z.string().min(1),
  description: z.string().min(1),
  writeScope: z.array(z.string().min(1)),
  sharedAccess: z.boolean().default(false),
  tools: z.array(z.string().min(1)).nullable().default(null),
  instructions: z.string(),
});

export type AgentProfile = z.infer<typeof AgentProfile>;

export type Profiles = Readonly<Record<string, AgentProfile>>;

export function parseProfile(source: string): AgentProfile {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (!match) throw new Error("agent profile needs a frontmatter block");
  return AgentProfile.parse({ ...(parseYaml(match[1] ?? "") as object), instructions: (match[2] ?? "").trim() });
}

export function loadProfiles(files: Readonly<Record<string, string>>): Profiles {
  const out: Record<string, AgentProfile> = {};
  for (const [path, source] of Object.entries(files)) {
    if (!path.endsWith(".md") || path.endsWith("README.md")) continue;
    const profile = parseProfile(source);
    out[profile.role] = profile;
  }
  return out;
}

export function scopeFor(profile: AgentProfile, feature: FeatureSpec): string[] {
  const scope = profile.writeScope.map((pattern) => pattern.replaceAll("{feature}", feature.id));
  if (profile.sharedAccess) scope.unshift(...feature.shared);
  return scope;
}

export function outOfScope(paths: readonly string[], scope: readonly string[]): string[] {
  return paths.filter((path) => !matchesScope(path, scope));
}

export interface CustomAgent {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly prompt: string;
  readonly tools: readonly string[] | null;
  readonly model: string;
}

export function customAgent(profile: AgentProfile, featureId: string, scope: readonly string[]): CustomAgent {
  const instructions = profile.instructions.replaceAll("{feature}", featureId);
  const rules = scope.length ? `You may only change files matching:\n${scope.join("\n")}` : "You may not change any file.";
  return {
    name: `chef-${profile.role}`,
    displayName: `chef ${profile.role}`,
    description: profile.description,
    prompt: `${instructions}\n\n${rules}`,
    tools: profile.tools,
    model: profile.model,
  };
}
