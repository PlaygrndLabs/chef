interface FileNode {
  readonly kind: "file";
  data: Uint8Array;
  mtimeMs: number;
  mode: number;
}

interface DirNode {
  readonly kind: "dir";
  readonly children: Map<string, Node>;
  mtimeMs: number;
}

type Node = FileNode | DirNode;

class FsError extends Error {
  constructor(
    readonly code: string,
    path: string,
  ) {
    super(`${code}: ${path}`);
  }
}

function parts(path: string): string[] {
  return path.split("/").filter((p) => p.length > 0 && p !== ".");
}

function encodingOf(options: unknown): string | undefined {
  if (typeof options === "string") return options;
  if (options && typeof options === "object" && "encoding" in options) return (options as { encoding?: string }).encoding;
  return undefined;
}

class Stats {
  readonly size: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly uid = 1;
  readonly gid = 1;
  readonly ino = 0;
  readonly dev = 1;
  private readonly kind: Node["kind"];

  constructor(node: Node) {
    this.kind = node.kind;
    this.size = node.kind === "file" ? node.data.byteLength : 0;
    this.mode = node.kind === "file" ? node.mode : 0o40755;
    this.mtimeMs = node.mtimeMs;
    this.ctimeMs = node.mtimeMs;
  }

  isFile(): boolean {
    return this.kind === "file";
  }

  isDirectory(): boolean {
    return this.kind === "dir";
  }

  isSymbolicLink(): boolean {
    return false;
  }
}

export class MemoryFs {
  private readonly root: DirNode = { kind: "dir", children: new Map(), mtimeMs: Date.now() };
  readonly promises = {
    readFile: (path: string, options?: unknown) => this.readFile(path, options),
    writeFile: (path: string, data: Uint8Array | string, options?: unknown) => this.writeFile(path, data, options),
    unlink: (path: string) => this.unlink(path),
    readdir: (path: string) => this.readdir(path),
    mkdir: (path: string) => this.mkdir(path),
    rmdir: (path: string) => this.rmdir(path),
    stat: (path: string) => this.stat(path),
    lstat: (path: string) => this.stat(path),
    readlink: async (path: string): Promise<string> => {
      throw new FsError("ENOENT", path);
    },
    symlink: async (_target: string, path: string): Promise<void> => {
      throw new FsError("EPERM", path);
    },
    chmod: async (): Promise<void> => undefined,
  };

  bytes(): number {
    let total = 0;
    const walk = (node: Node) => {
      if (node.kind === "file") total += node.data.byteLength;
      else for (const child of node.children.values()) walk(child);
    };
    walk(this.root);
    return total;
  }

  private lookup(path: string): Node | undefined {
    let node: Node = this.root;
    for (const part of parts(path)) {
      if (node.kind !== "dir") return undefined;
      const next = node.children.get(part);
      if (!next) return undefined;
      node = next;
    }
    return node;
  }

  private parent(path: string): { dir: DirNode; name: string } {
    const segments = parts(path);
    const name = segments.pop();
    if (!name) throw new FsError("EINVAL", path);
    const dir = this.lookup(segments.join("/"));
    if (!dir) throw new FsError("ENOENT", path);
    if (dir.kind !== "dir") throw new FsError("ENOTDIR", path);
    return { dir, name };
  }

  async readFile(path: string, options?: unknown): Promise<Uint8Array | string> {
    const node = this.lookup(path);
    if (!node) throw new FsError("ENOENT", path);
    if (node.kind !== "file") throw new FsError("EISDIR", path);
    const encoding = encodingOf(options);
    return encoding ? new TextDecoder().decode(node.data) : node.data;
  }

  async writeFile(path: string, data: Uint8Array | string, options?: unknown): Promise<void> {
    const { dir, name } = this.parent(path);
    const existing = dir.children.get(name);
    if (existing?.kind === "dir") throw new FsError("EISDIR", path);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    const mode = options && typeof options === "object" && "mode" in options ? Number((options as { mode: number }).mode) : 0o100644;
    dir.children.set(name, { kind: "file", data: bytes, mtimeMs: Date.now(), mode });
  }

  async unlink(path: string): Promise<void> {
    const { dir, name } = this.parent(path);
    const node = dir.children.get(name);
    if (!node) throw new FsError("ENOENT", path);
    if (node.kind === "dir") throw new FsError("EISDIR", path);
    dir.children.delete(name);
  }

  async readdir(path: string): Promise<string[]> {
    const node = this.lookup(path);
    if (!node) throw new FsError("ENOENT", path);
    if (node.kind !== "dir") throw new FsError("ENOTDIR", path);
    return [...node.children.keys()].sort();
  }

  async mkdir(path: string): Promise<void> {
    const { dir, name } = this.parent(path);
    if (dir.children.has(name)) throw new FsError("EEXIST", path);
    dir.children.set(name, { kind: "dir", children: new Map(), mtimeMs: Date.now() });
  }

  async rmdir(path: string): Promise<void> {
    const { dir, name } = this.parent(path);
    const node = dir.children.get(name);
    if (!node) throw new FsError("ENOENT", path);
    if (node.kind !== "dir") throw new FsError("ENOTDIR", path);
    if (node.children.size > 0) throw new FsError("ENOTEMPTY", path);
    dir.children.delete(name);
  }

  async stat(path: string): Promise<Stats> {
    const node = this.lookup(path);
    if (!node) throw new FsError("ENOENT", path);
    return new Stats(node);
  }
}
