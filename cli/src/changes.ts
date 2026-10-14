import { execFileSync } from "node:child_process";

export interface Change {
  readonly version: string;
  readonly date: string;
  readonly title: string;
  readonly pr: number | null;
}

export interface Commit {
  readonly sha: string;
  readonly date: string;
  readonly subject: string;
  readonly body: string;
  readonly files: readonly string[];
}

const RUNNING = /^(?:apps|core|workers|agents|template|adapters)\/|^wrangler\.jsonc$|^cli\/src\/deploy\.ts$/;
const NOT_RUNNING = /(?:^|\/)test\/|\.test\.[cm]?[jt]sx?$|\.md$/;
const SQUASHED = /^(.*?)\s*\(#(\d+)\)$/;
const MERGED = /^Merge pull request #(\d+) from /;
const NAME = /(?<![\w`./-])chef(?![\w`/-]|\.\w)/g;

export const shapesChef = (file: string): boolean => RUNNING.test(file) && !NOT_RUNNING.test(file);

export function changeOf(commit: Commit): Change | null {
  if (!commit.files.some(shapesChef)) return null;
  const merged = MERGED.exec(commit.subject);
  const squashed = merged ? null : SQUASHED.exec(commit.subject);
  const raw = merged ? (commit.body.split("\n").find((line) => line.trim()) ?? "") : (squashed?.[1] ?? commit.subject);
  const title = raw.trim().replace(/\.$/, "").replace(NAME, "Chef");
  if (!title) return null;
  const pr = merged?.[1] ?? squashed?.[2];
  return { version: commit.sha.slice(0, 12), date: commit.date.slice(0, 10), title, pr: pr ? Number(pr) : null };
}

const RECORD = "\x1e";
const FIELD = "\x1f";

export function parseLog(text: string): Commit[] {
  return text
    .split(RECORD)
    .filter((record) => record.trim())
    .map((record) => {
      const [sha = "", date = "", subject = "", body = "", files = ""] = record.split(FIELD);
      return { sha: sha.trim(), date: date.trim(), subject: subject.trim(), body: body.trim(), files: files.split("\n").map((f) => f.trim()).filter(Boolean) };
    });
}

export function changes(root: string, limit: number, ref = "HEAD"): Change[] {
  const log = execFileSync("git", ["log", "--first-parent", "--diff-merges=first-parent", "--name-only", `--format=${RECORD}%H${FIELD}%cI${FIELD}%s${FIELD}%b${FIELD}`, `-n${limit * 4}`, ref], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return parseLog(log)
    .flatMap((commit) => changeOf(commit) ?? [])
    .slice(0, limit);
}
