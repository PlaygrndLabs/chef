import { RULES_DIR, type ProjectRule } from "../checks/project-rules.ts";
import { globToRegExp } from "../util/glob.ts";

export interface GuardRule {
  readonly id: string;
  readonly message: string;
  readonly files: string;
  readonly forbid: string;
}

export interface TurnGuard {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly free: readonly string[];
  readonly blocked: Readonly<Record<string, string>>;
  readonly scope: string;
  readonly rules: readonly GuardRule[];
  readonly rulesDir: string;
}

export interface GuardInput {
  readonly scope: readonly string[];
  readonly generated: Iterable<string>;
  readonly locked: Iterable<string>;
  readonly owned: Iterable<readonly [string, string]>;
  readonly rules: readonly ProjectRule[];
}

export function turnGuard(input: GuardInput): TurnGuard {
  const blocked: Record<string, string> = {};
  for (const path of input.locked) blocked[path] = `${path} is a test the test agent wrote, and it is locked. Chef discards a turn that changes it, so make the code pass it instead.`;
  for (const [path, owner] of input.owned) blocked[path] = `${path} belongs to the ${owner} role in this feature, and only a file's owner changes it. Chef discards a turn that changes it, so build what you need in your own files and use this one as it is.`;
  return {
    allow: input.scope.filter((pattern) => !pattern.startsWith("!")).map((pattern) => globToRegExp(pattern).source),
    deny: input.scope.filter((pattern) => pattern.startsWith("!")).map((pattern) => globToRegExp(pattern.slice(1)).source),
    free: [...input.generated],
    blocked,
    scope: `This role may change only these paths: ${input.scope.join(", ") || "none"}. Chef discards a turn that writes anywhere else, so make the change inside them or leave it out.`,
    rules: input.rules.map((rule) => ({ id: rule.id, message: rule.message, files: globToRegExp(rule.files).source, forbid: rule.forbid })),
    rulesDir: RULES_DIR,
  };
}
