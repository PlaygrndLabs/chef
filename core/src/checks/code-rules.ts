import ts from "typescript";
import type { Tree } from "../git/tree.ts";

export interface CodeProblem {
  readonly rule: "no-comments" | "import-boundaries";
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
    if (to.kind === "app") return `feature "${from.name}" must not import the app shell`;
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

export function findBoundaryViolations(path: string, text: string): CodeProblem[] {
  const problems: CodeProblem[] = [];
  for (const { specifier, line } of findImports(path, text)) {
    const message = checkBoundary(path, specifier);
    if (message) problems.push({ rule: "import-boundaries", path, line, message: `${message} (import "${specifier}")` });
  }
  return problems;
}

export type CodeRule = CodeProblem["rule"];

export function checkTree(tree: Tree, rules: readonly CodeRule[] = ["no-comments", "import-boundaries"], ignore: (path: string) => boolean = () => false): CodeProblem[] {
  const problems: CodeProblem[] = [];
  for (const [path, text] of Object.entries(tree)) {
    if (!CODE_FILE.test(path) || ignore(path) || path.endsWith(".d.ts")) continue;
    if (rules.includes("no-comments")) problems.push(...findComments(path, text));
    if (rules.includes("import-boundaries")) problems.push(...findBoundaryViolations(path, text));
  }
  return problems;
}

export function formatProblems(problems: readonly CodeProblem[]): string {
  return problems.map((p) => `${p.path}:${p.line} [${p.rule}] ${p.message}`).join("\n");
}
