import { describe, expect, it } from "vitest";
import { applyProjectUpdate, readProjectSettings, viewProjectSettings } from "../../src/project-settings.ts";

const secret = () => "whsec";

describe("project settings", () => {
  it("links a GitHub repository with a rolling pull request by default and hides the token", () => {
    const result = applyProjectUpdate(undefined, { git: { url: "https://github.com/acme/app.git/", token: "ghp_abcdefgh1234" } }, secret);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = viewProjectSettings(readProjectSettings(result.settings));
    expect(view.git).toEqual({ url: "https://github.com/acme/app.git", branch: "main", mode: "pull-request", syncBranch: "chef", webhookSecret: "whsec", tokenHint: "…1234", pullRequests: true });
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

  it("unlinks and resets the preview idle time", () => {
    const linked = applyProjectUpdate(undefined, { previewIdleMinutes: 30, git: { url: "https://github.com/acme/app", mode: "off" } }, secret);
    if (!linked.ok) throw new Error(linked.error);
    const cleared = applyProjectUpdate(linked.settings, { previewIdleMinutes: null, git: null }, secret);
    if (!cleared.ok) throw new Error(cleared.error);
    expect(readProjectSettings(cleared.settings)).toEqual({ previewIdleMinutes: 60, git: null });
  });
});
