import git, { type HttpClient } from "isomorphic-git";
import webHttp from "isomorphic-git/http/web";
import type { ExternalRemote, PullRequestRef, RepoToken } from "@chef/core";
import { tokenSecret, type ArtifactsControl } from "./artifacts.ts";
import { MemoryFs } from "./memory-fs.ts";

const GITDIR = "/external.git";

export interface ExternalLinkConfig {
  readonly url: string;
  readonly branch: string;
  readonly token: string | null;
  readonly username?: string;
}

export interface GitHubRepo {
  readonly owner: string;
  readonly repo: string;
}

export function gitHubRepo(url: string): GitHubRepo | null {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url);
  return match ? { owner: match[1] as string, repo: match[2] as string } : null;
}

export class GitRemote implements ExternalRemote {
  readonly url: string;
  readonly branch: string;
  readonly importSource: { readonly url: string; readonly branch: string; readonly token?: string };

  constructor(
    private readonly link: ExternalLinkConfig,
    private readonly artifacts: ArtifactsControl,
    private readonly options: { readonly http?: HttpClient; readonly fetcher?: typeof fetch; readonly api?: string } = {},
  ) {
    this.url = link.url;
    this.branch = link.branch;
    this.importSource = { url: link.url, branch: link.branch, ...(link.token ? { token: link.token } : {}) };
  }

  private get http(): HttpClient {
    return this.options.http ?? webHttp;
  }

  private auth() {
    const token = this.link.token;
    return token ? () => ({ username: this.link.username ?? "x-access-token", password: token }) : undefined;
  }

  async head(branch = this.branch): Promise<string | null> {
    const onAuth = this.auth();
    const refs = await git.listServerRefs({ http: this.http, url: this.url, prefix: `refs/heads/${branch}`, ...(onAuth ? { onAuth } : {}) });
    return refs.find((r) => r.ref === `refs/heads/${branch}`)?.oid ?? null;
  }

  async pull(input: { readonly token: RepoToken; readonly ref: string }): Promise<string | null> {
    const target = await this.artifacts.info(input.token.repo);
    if (!target) throw new Error(`unknown repo ${input.token.repo}`);
    const fs = await this.fresh({ external: this.url, artifacts: target.remote });
    const secret = tokenSecret(input.token.secret);
    const artifactsAuth = () => ({ username: "x", password: secret });
    const known = await git.listServerRefs({ http: this.http, url: target.remote, prefix: `refs/heads/${input.ref}`, onAuth: artifactsAuth });
    if (known.some((r) => r.ref === `refs/heads/${input.ref}`)) await git.fetch({ fs, http: this.http, gitdir: GITDIR, url: target.remote, ref: input.ref, remoteRef: `refs/heads/${input.ref}`, remote: "artifacts", singleBranch: true, tags: false, onAuth: artifactsAuth });
    const onAuth = this.auth();
    const fetched = await git.fetch({ fs, http: this.http, gitdir: GITDIR, url: this.url, ref: this.branch, remoteRef: `refs/heads/${this.branch}`, remote: "external", singleBranch: true, tags: false, ...(onAuth ? { onAuth } : {}) });
    const head = fetched.fetchHead;
    if (!head) return null;
    await git.writeRef({ fs, gitdir: GITDIR, ref: "refs/heads/sync", value: head, force: true });
    const result = await git.push({ fs, http: this.http, gitdir: GITDIR, url: target.remote, ref: "refs/heads/sync", remoteRef: `refs/heads/${input.ref}`, force: true, onAuth: artifactsAuth });
    if (!result.ok) throw new Error(`copying ${this.url} into ${input.token.repo} was rejected: ${result.error ?? JSON.stringify(result.refs)}`);
    return head;
  }

  async push(input: { readonly repo: string; readonly ref: string; readonly commitId: string; readonly branch: string; readonly force: boolean }): Promise<void> {
    if (input.branch === this.branch) throw new Error(`chef never pushes to ${this.branch} of ${this.url}`);
    const onAuth = this.auth();
    if (!onAuth) throw new Error(`pushing to ${this.url} needs an access token`);
    const source = await this.artifacts.info(input.repo);
    if (!source) throw new Error(`unknown repo ${input.repo}`);
    const fs = await this.fresh({ external: this.url, artifacts: source.remote });
    const token = await this.artifacts.createToken(input.repo, "read", 300);
    try {
      const artifactsAuth = () => ({ username: "x", password: tokenSecret(token.plaintext) });
      const external = await git.listServerRefs({ http: this.http, url: this.url, onAuth });
      for (const ref of [`refs/heads/${this.branch}`, `refs/heads/${input.branch}`]) {
        if (external.some((r) => r.ref === ref)) await git.fetch({ fs, http: this.http, gitdir: GITDIR, url: this.url, ref, remoteRef: ref, remote: "external", singleBranch: true, tags: false, onAuth });
      }
      await git.fetch({ fs, http: this.http, gitdir: GITDIR, url: source.remote, ref: input.ref, remoteRef: `refs/heads/${input.ref}`, remote: "artifacts", singleBranch: true, tags: false, onAuth: artifactsAuth });
    } finally {
      await this.artifacts.revokeToken(input.repo, token.plaintext).catch(() => undefined);
    }
    await git.writeRef({ fs, gitdir: GITDIR, ref: "refs/heads/sync", value: input.commitId, force: true });
    const result = await git.push({ fs, http: this.http, gitdir: GITDIR, url: this.url, ref: "refs/heads/sync", remoteRef: `refs/heads/${input.branch}`, force: input.force, onAuth });
    if (!result.ok) throw new Error(`push to ${input.branch} of ${this.url} was rejected: ${result.error ?? JSON.stringify(result.refs)}`);
  }

  async pullRequest(input: { readonly head: string; readonly title: string; readonly body: string }): Promise<PullRequestRef> {
    const repo = gitHubRepo(this.url);
    if (!repo) throw new Error(`pull requests need a github.com repository, not ${this.url}`);
    if (!this.link.token) throw new Error("opening pull requests needs an access token");
    const api = this.options.api ?? "https://api.github.com";
    const fetcher = this.options.fetcher ?? fetch;
    const headers = { authorization: `Bearer ${this.link.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "chef", "content-type": "application/json" };
    const base = `${api}/repos/${repo.owner}/${repo.repo}/pulls`;
    const listed = await fetcher(`${base}?state=open&head=${encodeURIComponent(`${repo.owner}:${input.head}`)}&base=${encodeURIComponent(this.branch)}`, { headers });
    if (!listed.ok) throw new Error(`listing pull requests failed with ${listed.status}: ${(await listed.text()).slice(0, 300)}`);
    const open = (await listed.json()) as { number: number; html_url: string }[];
    const existing = open[0];
    const response = existing
      ? await fetcher(`${base}/${existing.number}`, { method: "PATCH", headers, body: JSON.stringify({ title: input.title, body: input.body }) })
      : await fetcher(base, { method: "POST", headers, body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: this.branch, maintainer_can_modify: true }) });
    if (!response.ok) throw new Error(`${existing ? "updating" : "opening"} the pull request failed with ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const pr = (await response.json()) as { number: number; html_url: string };
    return { number: pr.number, url: pr.html_url };
  }

  private async fresh(remotes: Readonly<Record<string, string>>): Promise<MemoryFs> {
    const fs = new MemoryFs();
    await git.init({ fs, gitdir: GITDIR, bare: true, defaultBranch: "sync" });
    for (const [remote, url] of Object.entries(remotes)) await git.addRemote({ fs, gitdir: GITDIR, remote, url, force: true });
    return fs;
  }
}
