import { describe, expect, it } from "vitest";
import { applyProjectUpdate, readProjectSettings, requestsGitHubApp, viewProjectSettings, withLinkBranch } from "../../src/project-settings.ts";
import type { BranchChoice } from "../../src/external-git.ts";

const secret = () => "whsec";

describe("project settings", () => {
  it("links a GitHub repository with a rolling pull request by default and hides the token", () => {
    const result = applyProjectUpdate(undefined, { git: { url: "https://github.com/acme/app.git/", token: "ghp_abcdefgh1234" } }, secret);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = viewProjectSettings(readProjectSettings(result.settings));
    expect(view.git).toEqual({ url: "https://github.com/acme/app.git", branch: "main", mode: "pull-request", syncBranch: "chef", webhookSecret: "whsec", tokenHint: "…1234", pullRequests: true, github: false });
    expect(JSON.stringify(view)).not.toContain("ghp_");
  });

  it("keeps the token and webhook secret when the same repository is saved again", () => {
    const first = applyProjectUpdate(undefined, { git: { url: "https://github.com/acme/app", token: "ghp_abcdefgh1234" } }, secret);
    if (!first.ok) throw new Error(first.error);
    const second = applyProjectUpdate(first.settings, { git: { url: "https://github.com/acme/app", mode: "branch", syncBranch: "bot" } }, () => "other");
    if (!second.ok) throw new Error(second.error);
    expect(second.settings.git).toMatchObject({ token: "ghp_abcdefgh1234", webhookSecret: "whsec", mode: "branch", syncBranch: "bot" });
    const moved = applyProjectUpdate(second.settings, { git: { url: "https://github.com/acme/other", mode: "off" } }, () => "fresh");
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.settings.git).toMatchObject({ token: null, webhookSecret: "fresh" });
  });

  it("refuses links that would push to main, leak a token or need a missing one", () => {
    const refuse = (git: unknown) => applyProjectUpdate(undefined, { git }, secret);
    expect(refuse({ url: "https://github.com/acme/app", token: "t", syncBranch: "main" })).toMatchObject({ ok: false, error: expect.stringContaining("never pushes to main") });
    expect(refuse({ url: "https://user:pw@github.com/acme/app", token: "t" })).toMatchObject({ ok: false, error: expect.stringContaining("own field") });
    expect(refuse({ url: "http://github.com/acme/app", token: "t" })).toMatchObject({ ok: false });
    expect(refuse({ url: "https://github.com/acme/app" })).toMatchObject({ ok: false, error: expect.stringContaining("access token") });
    expect(refuse({ url: "https://gitlab.com/acme/app", token: "t" })).toMatchObject({ ok: false, error: expect.stringContaining("github.com") });
    expect(refuse({ url: "https://gitlab.com/acme/app", token: "t", mode: "branch" })).toMatchObject({ ok: true });
    expect(refuse({ url: "https://gitlab.com/acme/app", mode: "off" })).toMatchObject({ ok: true });
  });

  it("links through Chef's GitHub App without a token and drops an earlier token", () => {
    const withToken = applyProjectUpdate(undefined, { git: { url: "https://github.com/acme/app", token: "ghp_abcdefgh1234" } }, secret);
    if (!withToken.ok) throw new Error(withToken.error);
    const body = { git: { url: "https://github.com/acme/app/", github: true, branch: "trunk" } };
    expect(requestsGitHubApp(body)).toBe("https://github.com/acme/app");
    expect(requestsGitHubApp({ git: { url: "https://github.com/acme/app", token: "t" } })).toBeNull();
    expect(applyProjectUpdate(withToken.settings, body, secret)).toMatchObject({ ok: false, error: expect.stringContaining("GitHub App cannot reach") });
    const linked = applyProjectUpdate(withToken.settings, body, secret, 99);
    if (!linked.ok) throw new Error(linked.error);
    expect(linked.settings.git).toMatchObject({ token: null, installation: 99, branch: "trunk", mode: "pull-request", webhookSecret: "whsec" });
    const view = viewProjectSettings(readProjectSettings(linked.settings));
    expect(view.git).toMatchObject({ github: true, tokenHint: null });
    expect(JSON.stringify(view)).not.toContain("99");
    const back = applyProjectUpdate(linked.settings, { git: { url: "https://github.com/acme/app", mode: "off" } }, secret);
    if (!back.ok) throw new Error(back.error);
    expect(back.settings.git).not.toHaveProperty("installation");
    expect(applyProjectUpdate(undefined, { git: { url: "https://gitlab.com/acme/app", github: true, mode: "branch" } }, secret, 5)).toMatchObject({ ok: false, error: expect.stringContaining("github.com") });
  });

  it("unlinks and resets the app idle time", () => {
    const linked = applyProjectUpdate(undefined, { appIdleMinutes: 30, git: { url: "https://github.com/acme/app", mode: "off" } }, secret);
    if (!linked.ok) throw new Error(linked.error);
    const cleared = applyProjectUpdate(linked.settings, { appIdleMinutes: null, git: null }, secret);
    if (!cleared.ok) throw new Error(cleared.error);
    expect(readProjectSettings(cleared.settings)).toEqual({ appIdleMinutes: 60, attempts: null, merge: "auto", git: null });
    const manual = applyProjectUpdate(cleared.settings, { merge: "manual" }, secret);
    if (!manual.ok) throw new Error(manual.error);
    expect(viewProjectSettings(readProjectSettings(manual.settings)).merge).toBe("manual");
    expect(applyProjectUpdate(cleared.settings, { merge: "sometimes" }, secret).ok).toBe(false);
    const tries = applyProjectUpdate(cleared.settings, { attempts: 3 }, secret);
    if (!tries.ok) throw new Error(tries.error);
    expect(readProjectSettings(tries.settings).attempts).toBe(3);
    expect(viewProjectSettings(readProjectSettings(tries.settings)).attempts).toBe(3);
    expect(applyProjectUpdate(tries.settings, { attempts: 9 }, secret).ok).toBe(false);
    const back = applyProjectUpdate(tries.settings, { attempts: null }, secret);
    if (!back.ok) throw new Error(back.error);
    expect(readProjectSettings(back.settings).attempts).toBeNull();
  });
});

describe("the linked repository's main branch", () => {
  const master = async (_link: { url: string; token: string | null }, wanted: string | null): Promise<BranchChoice> => (wanted === null || wanted === "master" ? { ok: true, branch: "master" } : { ok: false, error: `no branch ${wanted}` });

  it("takes the repository's own main branch when none is named", async () => {
    const seen: unknown[] = [];
    const filled = await withLinkBranch(undefined, { git: { url: "https://git.example.com/acme/app/", token: "tok", mode: "branch" } }, async (link, wanted) => (seen.push({ link, wanted }), master(link, wanted)));
    if (!filled.ok) throw new Error(filled.error);
    expect(seen).toEqual([{ link: { url: "https://git.example.com/acme/app", token: "tok" }, wanted: null }]);
    const linked = applyProjectUpdate(undefined, filled.body, secret);
    if (!linked.ok) throw new Error(linked.error);
    expect(linked.settings.git).toMatchObject({ branch: "master" });
  });

  it("refuses a branch the repository does not have and skips the check when nothing changed", async () => {
    expect(await withLinkBranch(undefined, { git: { url: "https://git.example.com/acme/app", branch: "main" } }, master)).toEqual({ ok: false, error: "no branch main" });
    const stored = { git: { url: "https://git.example.com/acme/app", branch: "trunk", token: "tok", mode: "branch" as const, syncBranch: "chef", webhookSecret: "s" } };
    const never = async (): Promise<BranchChoice> => {
      throw new Error("not called");
    };
    expect(await withLinkBranch(stored, { git: { url: "https://git.example.com/acme/app", branch: "trunk", mode: "off" } }, never)).toMatchObject({ ok: true });
    expect(await withLinkBranch(undefined, { git: { url: "https://github.com/acme/app", github: true } }, never)).toMatchObject({ ok: true });
    expect(await withLinkBranch(undefined, { appIdleMinutes: 30 }, never)).toMatchObject({ ok: true });
  });

  it("reuses the stored token for the same repository", async () => {
    const stored = { git: { url: "https://git.example.com/acme/app", branch: "trunk", token: "kept", mode: "branch" as const, syncBranch: "chef", webhookSecret: "s" } };
    let token: string | null = null;
    await withLinkBranch(stored, { git: { url: "https://git.example.com/acme/app" } }, async (link, wanted) => ((token = link.token), master(link, wanted)));
    expect(token).toBe("kept");
  });
});
