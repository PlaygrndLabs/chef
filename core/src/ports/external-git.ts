import type { RepoToken } from "./repo-host.ts";

export interface PullRequestRef {
  readonly number: number;
  readonly url: string;
}

export interface ExternalRemote {
  readonly url: string;
  readonly branch: string;
  readonly importSource?: { readonly url: string; readonly branch: string; readonly token?: string };
  head(branch?: string): Promise<string | null>;
  pull(input: { readonly token: RepoToken; readonly ref: string }): Promise<string | null>;
  push(input: { readonly repo: string; readonly ref: string; readonly commitId: string; readonly branch: string; readonly force: boolean }): Promise<void>;
  pullRequest?(input: { readonly head: string; readonly title: string; readonly body: string }): Promise<PullRequestRef>;
}
