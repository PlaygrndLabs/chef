import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactsControl, ArtifactsReader, CommitMeta, ControlRepo } from "../src/artifacts.ts";

interface TokenRecord {
  readonly repo: string;
  readonly scope: "read" | "write";
  readonly expiresAt: number;
  revoked: boolean;
}

export class LocalGitServer {
  readonly root = mkdtempSync(join(tmpdir(), "chef-git-"));
  readonly tokens = new Map<string, TokenRecord>();
  readonly pushes: { repo: string; token: string }[] = [];
  private server: Server | null = null;
  private port = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const match = /^\/git\/([^/]+)\.git(\/.*)$/.exec(url.pathname);
      if (!match) return void res.writeHead(404).end();
      const [, repo, rest] = match as unknown as [string, string, string];
      const header = req.headers.authorization ?? "";
      const password = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":") : "";
      const token = this.tokens.get(password);
      const wantsWrite = rest.endsWith("git-receive-pack") || url.searchParams.get("service") === "git-receive-pack";
      if (!token || token.revoked || token.expiresAt < Date.now() || token.repo !== repo) return void res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' }).end();
      if (wantsWrite && token.scope !== "write") return void res.writeHead(403).end();
      if (rest.endsWith("git-receive-pack") && req.method === "POST") this.pushes.push({ repo, token: password });
      const child = spawn("git", ["http-backend"], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: this.root,
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: `/${repo}.git${rest}`,
          REQUEST_METHOD: req.method ?? "GET",
          QUERY_STRING: url.search.slice(1),
          CONTENT_TYPE: req.headers["content-type"] ?? "",
          REMOTE_USER: "x",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.receivepack",
          GIT_CONFIG_VALUE_0: "true",
        },
      });
      req.pipe(child.stdin);
      let buffer = Buffer.alloc(0);
      let headersDone = false;
      child.stdout.on("data", (chunk: Buffer) => {
        if (headersDone) return void res.write(chunk);
        buffer = Buffer.concat([buffer, chunk]);
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString().split("\r\n");
        let status = 200;
        for (const line of head) {
          const [key, ...value] = line.split(":");
          if (!key) continue;
          if (key.toLowerCase() === "status") status = Number.parseInt(value.join(":").trim(), 10);
          else res.setHeader(key, value.join(":").trim());
        }
        res.writeHead(status);
        headersDone = true;
        res.write(buffer.subarray(end + 4));
      });
      child.stdout.on("end", () => res.end());
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.port = typeof address === "object" && address ? address.port : 0;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    rmSync(this.root, { recursive: true, force: true });
  }

  remote(name: string): string {
    return `http://127.0.0.1:${this.port}/git/${name}.git`;
  }

  readonly reads: string[] = [];

  reader(): ArtifactsReader {
    const gitDir = (repo: string) => join(this.root, `${repo}.git`);
    const run = (repo: string, args: string[]): Buffer | null => {
      try {
        return execFileSync("git", ["--git-dir", gitDir(repo), ...args], { stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        return null;
      }
    };
    const commit = (repo: string, hash: string): CommitMeta | null => {
      const raw = run(repo, ["cat-file", "commit", hash])?.toString();
      if (!raw) return null;
      const split = raw.indexOf("\n\n");
      const headers = raw.slice(0, split).split("\n");
      const author = /^author (.*) <(.*)> (\d+) /.exec(headers.find((h) => h.startsWith("author ")) ?? "");
      return {
        hash,
        treeHash: (headers.find((h) => h.startsWith("tree ")) ?? "").slice(5),
        parents: headers.filter((h) => h.startsWith("parent ")).map((h) => h.slice(7)),
        message: raw.slice(split + 2).replace(/\n$/, ""),
        author: { name: author?.[1] ?? "", email: author?.[2] ?? "" },
        authoredAt: Number(author?.[3] ?? 0),
      };
    };
    return {
      readCommit: async (repo, hash) => (this.reads.push(`commit ${repo}`), commit(repo, hash)),
      readTree: async (repo, hash) => {
        this.reads.push(`tree ${repo}`);
        const out = run(repo, ["ls-tree", hash])?.toString();
        if (out === undefined) return null;
        const kinds: Record<string, string> = { "100644": "blob", "100755": "exec", "120000": "symlink", "160000": "gitlink", "040000": "tree" };
        return out
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [meta, name] = line.split("\t") as [string, string];
            const [mode, , hash] = meta.split(" ") as [string, string, string];
            return { name, mode, hash, type: kinds[mode] ?? "blob" };
          });
      },
      readBlob: async (repo, hash) => {
        this.reads.push(`blob ${repo}`);
        const out = run(repo, ["cat-file", "blob", hash]);
        return out ? new Uint8Array(out) : null;
      },
      log: async (repo, ref, limit) => {
        this.reads.push(`log ${repo} ${ref}`);
        const out = run(repo, ["log", "--first-parent", `-n${limit}`, "--format=%H", ref.startsWith("refs/") ? ref : `refs/heads/${ref}`])?.toString();
        if (!out) return [];
        return out
          .split("\n")
          .filter(Boolean)
          .map((hash) => commit(repo, hash))
          .filter((c): c is CommitMeta => c !== null);
      },
    };
  }

  control(options: { readonly read?: boolean } = {}): ArtifactsControl {
    const repos = new Map<string, ControlRepo>();
    return {
      ...(options.read ? { read: this.reader() } : {}),
      delete: async (name) => {
        if (!repos.delete(name)) return false;
        rmSync(join(this.root, `${name}.git`), { recursive: true, force: true });
        return true;
      },
      create: async (name, opts) => {
        execFileSync("git", ["init", "--bare", "-q", "-b", opts.defaultBranch, join(this.root, `${name}.git`)]);
        const repo = { name, remote: this.remote(name), defaultBranch: opts.defaultBranch };
        repos.set(name, repo);
        return repo;
      },
      fork: async (source, name) => {
        const from = repos.get(source);
        if (!from) throw new Error(`unknown repo ${source}`);
        execFileSync("git", ["clone", "--bare", "-q", "--single-branch", "-b", from.defaultBranch, join(this.root, `${source}.git`), join(this.root, `${name}.git`)]);
        const repo = { name, remote: this.remote(name), defaultBranch: from.defaultBranch };
        repos.set(name, repo);
        return repo;
      },
      info: async (name) => repos.get(name) ?? null,
      createToken: async (repo, scope, ttl) => {
        const secret = `art_v1_${randomBytes(20).toString("hex")}`;
        const expiresAt = Date.now() + ttl * 1000;
        this.tokens.set(secret, { repo, scope, expiresAt, revoked: false });
        return { plaintext: `${secret}?expires=${Math.floor(expiresAt / 1000)}`, expiresAt };
      },
      revokeToken: async (_repo, token) => {
        const record = this.tokens.get(token.split("?expires=")[0] as string);
        if (record) record.revoked = true;
      },
    };
  }

  gitLog(repo: string, ref = "main"): string {
    return execFileSync("git", ["--git-dir", join(this.root, `${repo}.git`), "log", "--format=%H %s", ref]).toString();
  }

  gitNotes(repo: string, namespace: string, oid: string): string {
    return execFileSync("git", ["--git-dir", join(this.root, `${repo}.git`), "notes", `--ref=${namespace}`, "show", oid]).toString();
  }
}
