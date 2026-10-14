import type { FileChanges, Tree } from "../git/tree.ts";
import { projectRules, type ProjectRule } from "../checks/project-rules.ts";
import { readSpec } from "../spec/lint.ts";
import { renderFeature } from "../spec/parse.ts";
import { specPath, type FeatureSpec } from "../spec/schema.ts";
import { hashHex } from "../util/hash.ts";
import { globToRegExp } from "../util/glob.ts";

export function featureFolders(tree: Tree): string[] {
  const ids = new Set<string>();
  for (const path of Object.keys(tree)) {
    const match = /^features\/([a-z][a-z0-9-]*)\/index\.ts$/.exec(path);
    if (match) ids.add(match[1] as string);
  }
  return [...ids].sort();
}

export function featureMapProblems(tree: Tree): string[] {
  const folders = new Set(featureFolders(tree));
  const spec = readSpec(tree);
  const problems: string[] = [];
  for (const id of folders) if (!spec.some((f) => f.id === id)) problems.push(`features/${id} has no spec entry`);
  for (const feature of spec) if (feature.status === "merged" && !folders.has(feature.id)) problems.push(`spec ${feature.id} is merged but features/${feature.id}/index.ts is missing`);
  return problems;
}

const TEST_NAME = /\b(?:test|it)\(\s*(["'`])(AC[1-9][0-9]*):\s*((?:(?!\1).)*)\1/g;

export function gardenFeatureMap(tree: Tree): FileChanges {
  const spec = readSpec(tree);
  const changes: Record<string, string> = {};
  for (const id of featureFolders(tree)) {
    if (spec.some((f) => f.id === id)) continue;
    const tests = Object.entries(tree).filter(([path]) => path.startsWith(`features/${id}/`) && path.endsWith(".test.ts"));
    const criteria = new Map<string, string>();
    for (const [, content] of tests) for (const m of content.matchAll(TEST_NAME)) if (!criteria.has(m[2] as string)) criteria.set(m[2] as string, m[3] as string);
    const feature: FeatureSpec = {
      id,
      title: id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
      status: "merged",
      entrypoint: `features/${id}/index.ts`,
      revision: 1,
      shared: [],
      env: [],
      acceptance: criteria.size ? [...criteria].map(([cid, text]) => ({ id: cid, text })) : [{ id: "AC1", text: `the tests in features/${id} pass` }],
      body: `Recorded by the gardener from the code in features/${id}; the planner should refine it.`,
    };
    changes[specPath(id)] = renderFeature(feature);
  }
  return changes;
}

export interface Correction {
  readonly id: string;
  readonly featureId: string;
  readonly sessionId: string;
  readonly role: string;
  readonly signature: string;
  readonly before: Readonly<Record<string, string | null>>;
  readonly after: Readonly<Record<string, string | null>>;
  readonly passing: readonly string[];
}

const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`|-?\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b/g;
const LITERAL_SOURCE = String.raw`(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\\n]|\\.)*\x60|-?\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)`;
const HOLE = "\u0000";

export function normalizeLine(line: string): string {
  return line.trim().replace(LITERAL, HOLE);
}

export function lineRegex(normalized: string): string {
  const escaped = normalized.split(HOLE).map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/\s+/g, "\\s*"));
  return `^\\s*${escaped.join(`\\s*${LITERAL_SOURCE}\\s*`)}\\s*$`;
}

function display(normalized: string): string {
  return normalized.split(HOLE).join("…");
}

function bodies(source: string, names: readonly string[]): string[] {
  const lines = source.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i] as string;
    const name = /\b(?:test|it)\(\s*(["'`])((?:(?!\1).)*)\1/.exec(header)?.[2];
    if (!name || !names.includes(name)) continue;
    const indent = /^\s*/.exec(header)?.[0] ?? "";
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] as string;
      if (line.startsWith(`${indent}})`) || line.startsWith(`${indent}}`)) break;
      out.push(line);
    }
  }
  return out;
}

function candidates(correction: Correction): string[] {
  const lines: string[] = [];
  for (const [path, before] of Object.entries(correction.before)) {
    if (before === null) continue;
    if (correction.signature === "red-tests") {
      if (path.endsWith(".test.ts")) lines.push(...bodies(before, correction.passing));
      continue;
    }
    const kept = new Set((correction.after[path] ?? "").split("\n").map((l) => l.trim()));
    lines.push(...before.split("\n").filter((l) => !kept.has(l.trim())));
  }
  return [...new Set(lines.map(normalizeLine).filter((l) => l.replace(HOLE, "").length >= 10 && /[A-Za-z]/.test(l)))];
}

export interface MinedRule {
  readonly rule: ProjectRule;
  readonly sessions: readonly string[];
}

export function mineRules(corrections: readonly Correction[], tree: Tree, minSessions = 3): MinedRule[] {
  const existing = projectRules(tree);
  const groups = new Map<string, { signature: string; normalized: string; sessions: Set<string>; corrections: Correction[] }>();
  for (const correction of corrections) {
    if (correction.signature === "project-lint" || correction.signature === "lane-owner") continue;
    for (const normalized of candidates(correction)) {
      const key = `${correction.signature}\n${normalized}`;
      const group = groups.get(key) ?? { signature: correction.signature, normalized, sessions: new Set(), corrections: [] };
      group.sessions.add(correction.sessionId);
      group.corrections.push(correction);
      groups.set(key, group);
    }
  }
  const mined: MinedRule[] = [];
  for (const group of groups.values()) {
    if (group.sessions.size < minSessions) continue;
    const forbid = lineRegex(group.normalized);
    if (existing.some((r) => r.forbid === forbid) || mined.some((m) => m.rule.forbid === forbid)) continue;
    const regex = new RegExp(forbid);
    const accepted = corrections.flatMap((c) => Object.values(c.after).flatMap((text) => (text ?? "").split("\n")));
    if (accepted.some((line) => regex.test(line))) continue;
    const paths = group.corrections.flatMap((c) => Object.keys(c.before));
    const files = paths.every((p) => p.endsWith(".test.ts")) ? "**/*.test.ts" : "features/**/*.ts";
    const fileRegex = globToRegExp(files);
    if (Object.entries(tree).some(([path, text]) => fileRegex.test(path) && text.split("\n").some((line) => regex.test(line)))) continue;
    const sessions = [...group.sessions].sort();
    mined.push({
      sessions,
      rule: {
        id: `mined-${hashHex(forbid).slice(0, 10)}`,
        message: `Lines like \`${display(group.normalized)}\` were removed in ${group.corrections.length} corrections (${group.signature}) across ${sessions.length} sessions`,
        files,
        forbid,
        source: group.signature,
        evidence: [...new Set(group.corrections.map((c) => c.id))].sort(),
      },
    });
  }
  return mined;
}
