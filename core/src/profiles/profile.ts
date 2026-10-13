import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { FeatureSpec } from "../spec/schema.ts";
import { matchesScope } from "../util/glob.ts";

export const Skill = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, "a skill name uses lower case letters, digits and dashes, starting with a letter"),
  description: z.string().trim().min(1, "say when the skill should be used").max(1024),
  body: z.string().trim().min(1, "the skill needs instructions").max(20_000),
  everyone: z.boolean().default(false),
});

export type Skill = z.infer<typeof Skill>;

export const AgentProfile = z.strictObject({
  role: z.string().regex(/^[a-z][a-z-]*$/),
  label: z.string().min(1).optional(),
  model: z.string().min(1),
  description: z.string().min(1),
  runs: z.enum(["agent", "api", "rules"]).default("agent"),
  plannable: z.boolean().default(false),
  writeScope: z.array(z.string().min(1)),
  sharedAccess: z.boolean().default(false),
  tools: z.array(z.string().min(1)).nullable().default(null),
  skills: z.array(Skill).default([]),
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
  if (feature.parent) scope.push(...profile.writeScope.filter((pattern) => pattern.includes("{feature}")).map((pattern) => pattern.replaceAll("{feature}", feature.parent as string)));
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
  readonly skills: readonly Skill[];
}

export function customAgent(profile: AgentProfile, featureId: string, scope: readonly string[], guidance = ""): CustomAgent {
  const own = profile.instructions.replaceAll("{feature}", featureId);
  const instructions = guidance ? `${own}\n\n${guidance}` : own;
  const rules = scope.length ? `You may only change files matching:\n${scope.join("\n")}` : "You may not change any file.";
  return {
    name: `chef-${profile.role}`,
    displayName: `chef ${profile.role}`,
    description: profile.description,
    prompt: `${instructions}\n\n${rules}`,
    tools: profile.tools,
    model: profile.model,
    skills: profile.skills,
  };
}

export function labelOf(profile: Pick<AgentProfile, "role" | "label">): string {
  return profile.label ?? profile.role;
}

export function withSkills(instructions: string, skills: readonly Skill[]): string {
  if (skills.length === 0) return instructions;
  return [instructions, ...skills.map((skill) => `## Skill: ${skill.name}\nUse when: ${skill.description}\n\n${skill.body}`)].join("\n\n");
}
