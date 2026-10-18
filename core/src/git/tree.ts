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

export type CommitSummary = Omit<Commit, "tree">;

export function applyChanges(tree: Tree, changes: FileChanges): Tree {
  const next = new Map(Object.entries(tree));
  for (const [path, content] of Object.entries(changes)) {
    if (content === null) next.delete(path);
    else next.set(path, content);
  }
  return sortTree(Object.fromEntries(next));
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

export function threeWayMerge(base: Tree, ours: Tree, theirs: Tree, resolvers: Readonly<Record<string, Resolver>> = {}, options: { readonly markConflicts?: boolean } = {}): MergeResult {
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
    else {
      conflicts.push(path);
      if (options.markConflicts) merged[path] = markConflict(base[path], ours[path], theirs[path]);
    }
  }
  for (const [path, resolver] of Object.entries(resolvers)) {
    if (pending.includes(path) || !(path in merged)) continue;
    const regenerated = resolver({ path, base: base[path], ours: ours[path], theirs: theirs[path], merged: sortTree(merged) });
    if (typeof regenerated === "string") merged[path] = regenerated;
  }
  return { tree: sortTree(merged), conflicts: conflicts.sort() };
}

function markConflict(base: string | undefined, ours: string | undefined, theirs: string | undefined): string {
  if (ours !== undefined && theirs !== undefined) return conflictMarkers(base ?? "", ours, theirs);
  return `<<<<<<< session\n${ours ?? ""}\n=======\n${theirs ?? ""}\n>>>>>>> main\n`;
}

export function conflictMarkers(base: string, ours: string, theirs: string): string {
  const b = base.split("\n");
  const tagged = [...hunks(b, ours.split("\n")).map((h) => ({ ...h, side: "ours" as const })), ...hunks(b, theirs.split("\n")).map((h) => ({ ...h, side: "theirs" as const }))].sort((x, y) => x.start - y.start || x.end - y.end);
  const clusters: { start: number; end: number; members: typeof tagged }[] = [];
  for (const hunk of tagged) {
    const last = clusters.at(-1);
    if (last && hunk.start <= last.end) {
      last.end = Math.max(last.end, hunk.end);
      last.members.push(hunk);
    } else clusters.push({ start: hunk.start, end: hunk.end, members: [hunk] });
  }
  const side = (members: typeof tagged, which: "ours" | "theirs", start: number, end: number) => {
    const out: string[] = [];
    let cursor = start;
    for (const hunk of members.filter((m) => m.side === which)) {
      out.push(...b.slice(cursor, hunk.start), ...hunk.lines);
      cursor = hunk.end;
    }
    out.push(...b.slice(cursor, end));
    return out;
  };
  const out: string[] = [];
  let cursor = 0;
  for (const cluster of clusters) {
    out.push(...b.slice(cursor, cluster.start));
    const mine = side(cluster.members, "ours", cluster.start, cluster.end);
    const other = side(cluster.members, "theirs", cluster.start, cluster.end);
    const sides = new Set(cluster.members.map((m) => m.side));
    if (sides.size === 1) out.push(...(sides.has("ours") ? mine : other));
    else if (mine.join("\n") === other.join("\n")) out.push(...mine);
    else out.push("<<<<<<< session", ...mine, "=======", ...other, ">>>>>>> main");
    cursor = cluster.end;
  }
  out.push(...b.slice(cursor));
  return out.join("\n");
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

const MAX_EDITS = 2000;

function hunks(base: readonly string[], next: readonly string[]): Hunk[] {
  let head = 0;
  while (head < base.length && head < next.length && base[head] === next[head]) head++;
  let tail = 0;
  while (tail < base.length - head && tail < next.length - head && base[base.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const a = base.slice(head, base.length - tail);
  const b = next.slice(head, next.length - tail);
  if (a.length === 0 && b.length === 0) return [];
  const matches = matchedLines(a, b);
  if (!matches) return [{ start: head, end: head + a.length, lines: b }];
  const result: Hunk[] = [];
  let i = 0;
  let j = 0;
  for (const [x, y] of [...matches, [a.length, b.length] as const]) {
    if (x > i || y > j) result.push({ start: head + i, end: head + x, lines: b.slice(j, y) });
    i = x + 1;
    j = y + 1;
  }
  return result;
}

function matchedLines(a: readonly string[], b: readonly string[]): (readonly [number, number])[] | null {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, MAX_EDITS);
  const offset = limit + 1;
  const v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number)) ? (v[offset + k + 1] as number) : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, d);
    }
  }
  return null;
}

function backtrack(a: readonly string[], b: readonly string[], trace: readonly Int32Array[], edits: number): (readonly [number, number])[] {
  const matches: (readonly [number, number])[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = edits; d >= 0; d--) {
    const before = trace[d] as Int32Array;
    const at = (k: number) => before[k + d] as number;
    const k = x - y;
    const down = d > 0 && (k === -d || (k !== d && at(k - 1) < at(k + 1)));
    const previousK = d === 0 ? 0 : down ? k + 1 : k - 1;
    const startX = d === 0 ? 0 : down ? at(previousK) : at(previousK) + 1;
    const startY = startX - k;
    while (x > startX && y > startY) {
      x--;
      y--;
      matches.push([x, y]);
    }
    if (d > 0) {
      x = at(previousK);
      y = x - previousK;
    }
  }
  return matches.reverse();
}
