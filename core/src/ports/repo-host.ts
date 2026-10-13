import type { Author, Commit, FileChanges, Resolver } from "../git/tree.ts";

export type TokenScope = "read" | "write";

export interface RepoInfo {
  readonly name: string;
  readonly remote: string;
  readonly defaultBranch: string;
  readonly forkedFrom?: string;
}

export interface RepoToken {
  readonly repo: string;
  readonly scope: TokenScope;
  readonly secret: string;
  readonly expiresAt: number;
}

export interface CommitInput {
  readonly ref: string;
  readonly parent: string | null;
  readonly changes: FileChanges;
  readonly message: string;
  readonly author: Author;
}

export type MergeOutcome =
  | { readonly status: "merged"; readonly commitId: string }
  | { readonly status: "up-to-date"; readonly commitId: string }
  | { readonly status: "fast-forward"; readonly commitId: string }
  | { readonly status: "conflict"; readonly paths: readonly string[] }
  | { readonly status: "conflicted"; readonly commitId: string; readonly paths: readonly string[] };

export interface MergeInput {
  readonly into: string;
  readonly from: { readonly repo: string; readonly ref: string };
  readonly message: string;
  readonly author: Author;
  readonly resolvers?: Readonly<Record<string, Resolver>>;
  readonly onConflict?: "fail" | "commit-markers";
}

export interface PushedEvent {
  readonly repo: string;
  readonly ref: string;
  readonly before: string | null;
  readonly after: string;
}

export interface RepoHost {
  createRepo(name: string, opts?: { defaultBranch?: string; description?: string }): Promise<RepoInfo>;
  fork(source: string, name: string): Promise<RepoInfo>;
  deleteRepo(name: string): Promise<boolean>;
  importRepo?(name: string, source: { readonly url: string; readonly branch: string; readonly token?: string }): Promise<RepoInfo>;
  info(repo: string): Promise<RepoInfo | null>;
  createToken(repo: string, scope: TokenScope, ttlSeconds: number): Promise<RepoToken>;
  revokeToken(token: RepoToken): Promise<void>;
  resolveRef(repo: string, ref: string): Promise<string | null>;
  readCommit(repo: string, id: string): Promise<Commit | null>;
  log(repo: string, ref: string, limit?: number): Promise<Commit[]>;
  commit(token: RepoToken, input: CommitInput): Promise<Commit>;
  pushRef(token: RepoToken, input: { ref: string; commitId: string; fromRepo?: string; force?: boolean }): Promise<PushedEvent>;
  merge(token: RepoToken, input: MergeInput): Promise<MergeOutcome>;
  addNote(token: RepoToken, input: { namespace: string; commitId: string; note: string }): Promise<void>;
  readNote(repo: string, namespace: string, commitId: string): Promise<string | null>;
  onPush(listener: (event: PushedEvent) => void): () => void;
}
