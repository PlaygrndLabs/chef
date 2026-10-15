import type { Tree } from "../git/tree.ts";
import { hashHex } from "../util/hash.ts";

export const TEMPLATE_MARKERS = ["app/gen.ts", "src/registry.gen.ts"] as const;

export function usesChefTemplate(tree: Readonly<Record<string, unknown>>): boolean {
  return TEMPLATE_MARKERS.every((path) => path in tree);
}

export const TEST_GLOBS = ["**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/test_*.*", "**/__tests__/**", "**/test/**", "**/tests/**", "**/spec/**"] as const;

const CHEF_PATHS = ["!spec/features/**", "!memory/**", "!.chef/**", "!lint/rules/**"] as const;

export function ownScope(scope: readonly string[]): string[] {
  const out: string[] = [];
  for (const pattern of scope) {
    const negated = pattern.startsWith("!");
    const glob = negated ? pattern.slice(1) : pattern;
    if (glob === "src/registry.gen.ts" || glob.startsWith("features/*/")) continue;
    if (negated && glob === "spec/**") {
      out.push("!spec/features/**");
      continue;
    }
    if (!glob.startsWith("features/")) {
      out.push(pattern);
      continue;
    }
    if (glob.endsWith("/flow.ts")) continue;
    if (/\.test\.[a-z]+$/.test(glob)) out.push(...(negated ? TEST_GLOBS.map((g) => `!${g}`) : [...TEST_GLOBS, ...CHEF_PATHS]));
    else if (!negated) out.push("**", ...CHEF_PATHS);
  }
  return [...new Set(out)];
}

export function structureGuidance(tree: Readonly<Record<string, unknown>>): string {
  return usesChefTemplate(tree) ? TEMPLATE_GUIDANCE : OWN_GUIDANCE;
}

const TEMPLATE_GUIDANCE = "# Project structure\n\nThis project uses Chef's template: each feature is a vertical slice under `features/<id>/` with its tests and `flow.ts`, and `src/registry.gen.ts` is generated from those folders. Follow your role's instructions about them.";

const OWN_GUIDANCE = [
  "# Project structure",
  "This project has its own structure, not Chef's template. Chef places no limits on its stack: follow the repository's own layout, language, frameworks, test tool and conventions, and ignore any instruction above that assumes Chef's template.",
  "- Read the README, the package files and the code around the change first. Change the files where this behavior already lives, and wire new code into the real app so a person sees it in the running app.",
  "- Never create `features/`, `flow.ts`, `shared/ui.ts` or `src/registry.gen.ts`, and never run `app gen`.",
  "- Write tests with the repository's own test tool, next to its existing tests and named the way they are. Name each test after its acceptance criterion id where the tool names tests (`AC1: ...`).",
  "- Keep the repository's own style, including its comments and formatting.",
  "- Plan work in the repository's existing files, not as a vertical slice, and keep it in one builder role unless its parts live in separate files.",
  "- Chef's checks are the repository's own: it installs the dependencies and runs the `typecheck`, `lint` and `test` scripts of its package.json when they exist. Never reject or redo a change for missing Chef template files or tests that are not named after criterion ids.",
].join("\n\n");

export interface CheckCommand {
  readonly name: string;
  readonly argv: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface CheckNote {
  readonly name: string;
  readonly ok: boolean;
  readonly log: string;
}

export interface RepoChecks {
  readonly install: (CheckCommand & { readonly key: string }) | null;
  readonly commands: readonly CheckCommand[];
  readonly notes: readonly CheckNote[];
}

const SCRIPTS = ["typecheck", "lint", "test"] as const;
const CHECK_ENV = { CI: "true", COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" } as const;
const INSTALL_TIMEOUT_MS = 600_000;
const LOCKFILES = ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "npm-shrinkwrap.json"] as const;
const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|mix\.lock|pubspec\.lock|Podfile\.lock|flake\.lock)$/;

export function isLockfile(path: string): boolean {
  return LOCKFILE.test(path);
}

export function repoChecks(tree: Tree): RepoChecks {
  const manifest = tree["package.json"];
  if (manifest === undefined) return { install: null, commands: [], notes: [{ name: "checks", ok: true, log: "This repository has no package.json, so Chef found no checks of its own to run: no install, typecheck, lint or test." }] };
  const pkg = parseManifest(manifest);
  const scripts = pkg.scripts;
  const commands = SCRIPTS.filter((name) => realScript(name, scripts[name])).map((name) => ({ name, argv: ["npm", "run", "--silent", name], env: CHECK_ENV }));
  const notes = commands.some((c) => c.name === "test") ? [] : [{ name: "test", ok: true, log: "package.json has no test script, so this repository has no tests for Chef to run." }];
  const argv = installCommand(tree, pkg.packageManager);
  const key = hashHex([argv.join(" "), manifest, ...LOCKFILES.map((path) => tree[path] ?? "")].join("\n"));
  return { install: { name: "install", argv, env: CHECK_ENV, timeoutMs: INSTALL_TIMEOUT_MS, key }, commands, notes };
}

function parseManifest(text: string): { readonly scripts: Readonly<Record<string, unknown>>; readonly packageManager: string | null } {
  try {
    const parsed = JSON.parse(text) as { scripts?: unknown; packageManager?: unknown } | null;
    const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? (parsed.scripts as Record<string, unknown>) : {};
    return { scripts, packageManager: typeof parsed?.packageManager === "string" ? parsed.packageManager : null };
  } catch {
    return { scripts: {}, packageManager: null };
  }
}

function realScript(name: string, script: unknown): boolean {
  if (typeof script !== "string" || !script.trim()) return false;
  return !(name === "test" && /no test specified/i.test(script));
}

function installCommand(tree: Tree, packageManager: string | null): string[] {
  const [tool, version] = (packageManager ?? "").split("+")[0]?.split("@") ?? [];
  if (tool === "pnpm" || (!tool && tree["pnpm-lock.yaml"] !== undefined)) return ["npx", "--yes", `pnpm@${tool === "pnpm" && version ? version : "9"}`, "install", "--frozen-lockfile"];
  if (tool === "yarn" && version && !version.startsWith("1.")) return ["corepack", `yarn@${version}`, "install", "--immutable"];
  if (tool === "yarn" || (!tool && tree["yarn.lock"] !== undefined)) return ["npx", "--yes", `yarn@${tool === "yarn" && version ? version : "1"}`, "install", "--frozen-lockfile"];
  if (tree["package-lock.json"] !== undefined || tree["npm-shrinkwrap.json"] !== undefined) return ["npm", "ci", "--no-audit", "--no-fund"];
  return ["npm", "install", "--no-audit", "--no-fund"];
}

export function entryPath(entrypoint: string): string {
  const match = /^(?:GET\s+)?(\/[^\s?#]*)$/i.exec(entrypoint.trim());
  const path = match?.[1];
  return path && !/[:{*]/.test(path) ? path : "/";
}
