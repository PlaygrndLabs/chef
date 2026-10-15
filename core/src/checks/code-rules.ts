import ts from "typescript";
import type { Tree } from "../git/tree.ts";
import { projectRuleProblems } from "./project-rules.ts";

export interface CodeProblem {
  readonly rule: "no-comments" | "import-boundaries" | "known-packages" | "test-isolation" | "project-rules";
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

const ALLOWED_COMMENT = /^(?:\/\/\/\s*<reference|\/\/\s*@ts-expect-error|\/\*\s*eslint-|\/\/\s*eslint-|#!)/;

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

function sourceOf(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function lineOf(file: ts.SourceFile, pos: number): number {
  return file.getLineAndCharacterOfPosition(pos).line + 1;
}

export function findComments(path: string, text: string): CodeProblem[] {
  const file = sourceOf(path, text);
  const seen = new Set<number>();
  const problems: CodeProblem[] = [];
  const collect = (ranges: readonly ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const comment = text.slice(range.pos, range.end);
      if (ALLOWED_COMMENT.test(comment)) continue;
      problems.push({ rule: "no-comments", path, line: lineOf(file, range.pos), message: `comment not allowed: ${comment.split("\n")[0]?.slice(0, 60)}` });
    }
  };
  const visit = (node: ts.Node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(file);
  collect(ts.getLeadingCommentRanges(text, file.endOfFileToken.getFullStart()));
  return problems.sort((a, b) => a.line - b.line);
}

export function findImports(path: string, text: string): { specifier: string; line: number }[] {
  const file = sourceOf(path, text);
  const found: { specifier: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, line: lineOf(file, node.getStart()) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) found.push({ specifier: arg.text, line: lineOf(file, node.getStart()) });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push({ specifier: node.argument.literal.text, line: lineOf(file, node.getStart()) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function resolveRelative(fromPath: string, specifier: string): string {
  const parts = fromPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

const TEST_FILE = /(?:\.test\.ts|(?:^|\/)flow\.ts)$/;

function area(path: string): { kind: "feature"; name: string } | { kind: "shared" } | { kind: "app" } | { kind: "other" } {
  const feature = /^features\/([^/]+)\//.exec(path);
  if (feature) return { kind: "feature", name: feature[1] as string };
  if (path.startsWith("shared/")) return { kind: "shared" };
  if (path.startsWith("src/")) return { kind: "app" };
  return { kind: "other" };
}

export function checkBoundary(fromPath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = resolveRelative(fromPath, specifier);
  const from = area(fromPath);
  const to = area(target);
  if (from.kind === "feature") {
    if (to.kind === "feature" && to.name !== from.name) return `feature "${from.name}" must not import feature "${to.name}"; move the contract to shared/`;
    if (to.kind === "app" && !(TEST_FILE.test(fromPath) && /^src\/registry\.gen(?:\.ts)?$/.test(target))) return `feature "${from.name}" must not import the app shell; its tests may import src/registry.gen.ts`;
    return null;
  }
  if (from.kind === "shared") {
    if (to.kind === "feature") return "shared/ must not import a feature";
    if (to.kind === "app") return "shared/ must not import the app shell";
    return null;
  }
  if (from.kind === "app" && to.kind === "feature") {
    const entry = new RegExp(`^features/${to.name}/index(?:\\.ts)?$`);
    if (!entry.test(target)) return `the app shell may import only features/${to.name}/index.ts`;
  }
  return null;
}

const FILE_MODULES = new Set(["fs", "fs/promises", "node:fs", "node:fs/promises"]);

export function checkRuntime(fromPath: string, specifier: string): string | null {
  if (!FILE_MODULES.has(specifier) || !/^(?:features|shared|src)\//.test(fromPath) || TEST_FILE.test(fromPath)) return null;
  return "the app runs on Cloudflare Workers, which have no files to read at runtime; keep text such as CSS in a .ts module that exports it as a string";
}

export function findBoundaryViolations(path: string, text: string): CodeProblem[] {
  const problems: CodeProblem[] = [];
  for (const { specifier, line } of findImports(path, text)) {
    const message = checkBoundary(path, specifier) ?? checkRuntime(path, specifier);
    if (message) problems.push({ rule: "import-boundaries", path, line, message: `${message} (import "${specifier}")` });
  }
  return problems;
}

export function packageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || /^[a-z]+:/.test(specifier)) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string);
}

export function declaredPackages(manifest: string): Set<string> {
  const parsed = JSON.parse(manifest) as Record<string, Record<string, string> | undefined>;
  return new Set(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((key) => Object.keys(parsed[key] ?? {})));
}

export function findUnknownPackages(path: string, text: string, declared: ReadonlySet<string>): CodeProblem[] {
  const problems: CodeProblem[] = [];
  for (const { specifier, line } of findImports(path, text)) {
    const name = packageName(specifier);
    if (name && !declared.has(name)) problems.push({ rule: "known-packages", path, line, message: `package "${name}" is not installed; import a node: builtin or a package listed in package.json` });
  }
  return problems;
}

const FEATURE_TEST = /^features\/[^/]+\/.*\.test\.ts$/;

function sharedScope(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isFunctionLike(current)) continue;
    const call = current.parent;
    if (!call || !ts.isCallExpression(call) || !call.arguments.includes(current as ts.Expression)) return false;
    const callee = ts.isPropertyAccessExpression(call.expression) ? call.expression.expression : call.expression;
    return ts.isIdentifier(callee) && (callee.text === "describe" || callee.text === "suite");
  }
  return true;
}

export function findSharedStores(path: string, text: string): CodeProblem[] {
  if (!FEATURE_TEST.test(path) || !text.includes("MemoryStore")) return [];
  const file = sourceOf(path, text);
  const problems: CodeProblem[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "MemoryStore" && sharedScope(node)) {
      problems.push({ rule: "test-isolation", path, line: lineOf(file, node.getStart()), message: "a store made outside a test is shared by every test after it; make the app inside each test with testApp(t, features) from app/testing.ts" });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

export type CodeRule = CodeProblem["rule"];

export function checkTree(tree: Tree, rules: readonly CodeRule[] = ["no-comments", "import-boundaries", "known-packages", "test-isolation", "project-rules"], ignore: (path: string) => boolean = () => false): CodeProblem[] {
  const problems: CodeProblem[] = [];
  const manifest = tree["package.json"];
  const declared = rules.includes("known-packages") && manifest !== undefined ? declaredPackages(manifest) : null;
  const isolated = rules.includes("test-isolation") && tree["app/testing.ts"] !== undefined;
  if (rules.includes("project-rules")) problems.push(...projectRuleProblems(tree, Object.keys(tree).filter((p) => !ignore(p))).map((p) => ({ rule: p.rule, path: p.path, line: p.line, message: p.message })));
  for (const [path, text] of Object.entries(tree)) {
    if (!CODE_FILE.test(path) || ignore(path) || path.endsWith(".d.ts")) continue;
    if (rules.includes("no-comments")) problems.push(...findComments(path, text));
    if (rules.includes("import-boundaries")) problems.push(...findBoundaryViolations(path, text));
    if (declared) problems.push(...findUnknownPackages(path, text, declared));
    if (isolated) problems.push(...findSharedStores(path, text));
  }
  return problems;
}

export function formatProblems(problems: readonly CodeProblem[]): string {
  return problems.map((p) => `${p.path}:${p.line} [${p.rule}] ${p.message}`).join("\n");
}
