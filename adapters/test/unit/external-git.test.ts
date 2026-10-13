import { describe, expect, it } from "vitest";
import { gitHubRepo, GitRemote } from "../../src/external-git.ts";
import type { ArtifactsControl } from "../../src/artifacts.ts";

const control = {} as ArtifactsControl;

describe("GitHub pull requests for the sync branch", () => {
  it("parses github.com repository URLs", () => {
    expect(gitHubRepo("https://github.com/PlaygrndLabs/kargah")).toEqual({ owner: "PlaygrndLabs", repo: "kargah" });
    expect(gitHubRepo("https://github.com/PlaygrndLabs/kargah.git")).toEqual({ owner: "PlaygrndLabs", repo: "kargah" });
    expect(gitHubRepo("https://gitlab.com/a/b")).toBeNull();
  });

  it("opens a pull request once and updates it afterwards", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    let open: { number: number; html_url: string }[] = [];
    const fetcher = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, body: init.body ? JSON.parse(init.body as string) : null });
      if (method === "GET") return Response.json(open);
      const pr = { number: 7, html_url: "https://github.com/o/r/pull/7" };
      open = [pr];
      return Response.json(pr, { status: method === "POST" ? 201 : 200 });
    }) as unknown as typeof fetch;
    const remote = new GitRemote({ url: "https://github.com/o/r", branch: "main", token: "tok" }, control, { fetcher });
    expect(await remote.pullRequest({ head: "chef", title: "chef: one", body: "a" })).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
    expect(await remote.pullRequest({ head: "chef", title: "chef: two", body: "b" })).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET", "PATCH"]);
    expect(calls[0]?.url).toBe("https://api.github.com/repos/o/r/pulls?state=open&head=o%3Achef&base=main");
    expect(calls[1]?.body).toMatchObject({ head: "chef", base: "main", title: "chef: one" });
    expect(calls[3]?.url).toBe("https://api.github.com/repos/o/r/pulls/7");
  });

  it("asks for a fresh token each time it talks to GitHub when the link uses chef's app", async () => {
    let minted = 0;
    const seen: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit = {}) => {
      seen.push(new Headers(init.headers).get("authorization") ?? "");
      return (init.method ?? "GET") === "GET" ? Response.json([]) : Response.json({ number: 1, html_url: "https://github.com/o/r/pull/1" }, { status: 201 });
    }) as unknown as typeof fetch;
    const remote = new GitRemote({ url: "https://github.com/o/r", branch: "main", token: null, tokenSource: async () => `ghs_${++minted}` }, control, { fetcher });
    await remote.pullRequest({ head: "chef", title: "t", body: "b" });
    expect(seen).toEqual(["Bearer ghs_1", "Bearer ghs_1"]);
    expect(await remote.importSource()).toEqual({ url: "https://github.com/o/r", branch: "main", token: "ghs_2" });
  });

  it("refuses pull requests outside GitHub and pushes to the linked main", async () => {
    const remote = new GitRemote({ url: "https://gitlab.com/a/b", branch: "main", token: "tok" }, control);
    await expect(remote.pullRequest({ head: "chef", title: "t", body: "b" })).rejects.toThrow(/github.com/);
    await expect(remote.push({ repo: "x", ref: "main", commitId: "c", branch: "main", force: true })).rejects.toThrow(/never pushes to main/);
  });
});
