export type Tree = Readonly<Record<string, string>>;

export type FileChanges = Readonly<Record<string, string | null>>;

export interface Author {
  readonly name: string;
  readonly email: string;
}

export interface Commit {
  readonly id: string;
  readonly parents: readonly string[];
  readonly tree: Tree;
  readonly message: string;
  readonly author: Author;
  readonly timestamp: number;
}

export function applyChanges(tree: Tree, changes: FileChanges): Tree {
  const next: Record<string, string> = { ...tree };
  for (const [path, content] of Object.entries(changes)) {
    if (content === null) delete next[path];
    else next[path] = content;
  }
  return sortTree(next);
}

export function diffTrees(from: Tree, to: Tree): FileChanges {
  const changes: Record<string, string | null> = {};
  for (const path of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const before = from[path];
    const after = to[path];
    if (before === after) continue;
    changes[path] = after ?? null;
  }
  return changes;
}

export function changedPaths(changes: FileChanges): string[] {
  return Object.keys(changes).sort();
}

export function sortTree(tree: Record<string, string>): Tree {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(tree).sort()) sorted[key] = tree[key] as string;
  return sorted;
}

export type Resolver = (input: { path: string; base: string | undefined; ours: string | undefined; theirs: string | undefined; merged: Tree }) => string | null | undefined;

export interface MergeResult {
  readonly tree: Tree;
  readonly conflicts: readonly string[];
}

export function threeWayMerge(base: Tree, ours: Tree, theirs: Tree, resolvers: Readonly<Record<string, Resolver>> = {}): MergeResult {
  const merged: Record<string, string> = {};
  const conflicts: string[] = [];
  const pending: string[] = [];
  const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const path of paths) {
    const b = base[path];
    const o = ours[path];
    const t = theirs[path];
    let result: string | undefined;
    if (o === t) result = o;
    else if (o === b) result = t;
    else if (t === b) result = o;
    else {
      const lines = mergeLines(b ?? "", o ?? "", t ?? "");
      if (lines !== null && o !== undefined && t !== undefined) result = lines;
      else {
        pending.push(path);
        continue;
      }
    }
    if (result !== undefined) merged[path] = result;
  }
  for (const path of pending) {
    const resolver = resolvers[path];
    const resolved = resolver?.({ path, base: base[path], ours: ours[path], theirs: theirs[path], merged: sortTree(merged) });
    if (typeof resolved === "string") merged[path] = resolved;
    else if (resolved === null) continue;
    else conflicts.push(path);
  }
  for (const [path, resolver] of Object.entries(resolvers)) {
    if (pending.includes(path) || !(path in merged)) continue;
    const regenerated = resolver({ path, base: base[path], ours: ours[path], theirs: theirs[path], merged: sortTree(merged) });
    if (typeof regenerated === "string") merged[path] = regenerated;
  }
  return { tree: sortTree(merged), conflicts: conflicts.sort() };
}

interface Hunk {
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

function mergeLines(base: string, ours: string, theirs: string): string | null {
  const b = base.split("\n");
  const ourHunks = hunks(b, ours.split("\n"));
  const theirHunks = hunks(b, theirs.split("\n"));
  const same = (x: Hunk, y: Hunk) => x.start === y.start && x.end === y.end && x.lines.join("\n") === y.lines.join("\n");
  const kept: Hunk[] = [...ourHunks];
  for (const t of theirHunks) {
    if (ourHunks.some((o) => same(o, t))) continue;
    if (ourHunks.some((o) => o.start <= t.end && t.start <= o.end)) return null;
    kept.push(t);
  }
  kept.sort((x, y) => x.start - y.start);
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of kept) {
    out.push(...b.slice(cursor, hunk.start));
    out.push(...hunk.lines);
    cursor = hunk.end;
  }
  out.push(...b.slice(cursor));
  return out.join("\n");
}

function hunks(base: readonly string[], next: readonly string[]): Hunk[] {
  const n = base.length;
  const m = next.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] as number[];
    const below = lcs[i + 1] as number[];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = base[i] === next[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number);
    }
  }
  const result: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: { start: number; lines: string[] } | null = null;
  const close = (end: number) => {
    if (open) result.push({ start: open.start, end, lines: open.lines });
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === next[j]) {
      close(i);
      i++;
      j++;
    } else if (j < m && (i >= n || (lcs[i]?.[j + 1] as number) >= (lcs[i + 1]?.[j] as number))) {
      open ??= { start: i, lines: [] };
      open.lines.push(next[j] as string);
      j++;
    } else {
      open ??= { start: i, lines: [] };
      i++;
    }
  }
  close(i);
  return result;
}
