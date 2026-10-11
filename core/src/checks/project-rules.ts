import { z } from "zod";
import type { Tree } from "../git/tree.ts";
import { globToRegExp } from "../util/glob.ts";

export const RULES_DIR = "lint/rules/";

export const ProjectRule = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  message: z.string().min(1),
  files: z.string().min(1),
  forbid: z.string().min(1),
  source: z.string().min(1),
  evidence: z.array(z.string()),
});

export type ProjectRule = z.infer<typeof ProjectRule>;

export interface RuleProblem {
  readonly rule: "project-rules";
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

export function projectRules(tree: Tree): ProjectRule[] {
  const rules: ProjectRule[] = [];
  for (const [path, content] of Object.entries(tree)) {
    if (!path.startsWith(RULES_DIR) || !path.endsWith(".json")) continue;
    try {
      const parsed = ProjectRule.safeParse(JSON.parse(content));
      if (parsed.success) rules.push(parsed.data);
    } catch {
      continue;
    }
  }
  return rules.sort((a, b) => a.id.localeCompare(b.id));
}

export function projectRuleProblems(tree: Tree, paths: readonly string[] = Object.keys(tree), rules: readonly ProjectRule[] = projectRules(tree)): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const compiled = rules.map((rule) => ({ rule, files: globToRegExp(rule.files), forbid: new RegExp(rule.forbid) }));
  for (const path of paths) {
    const text = tree[path];
    if (text === undefined || path.startsWith(RULES_DIR)) continue;
    for (const { rule, files, forbid } of compiled) {
      if (!files.test(path)) continue;
      text.split("\n").forEach((line, index) => {
        if (forbid.test(line)) problems.push({ rule: "project-rules", id: rule.id, path, line: index + 1, message: `${rule.message} [${rule.id}]` });
      });
    }
  }
  return problems;
}

export function rulePath(id: string): string {
  return `${RULES_DIR}${id}.json`;
}

export function renderRule(rule: ProjectRule): string {
  return `${JSON.stringify(rule, null, 2)}\n`;
}
