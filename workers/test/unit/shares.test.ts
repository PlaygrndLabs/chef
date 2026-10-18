import { describe, expect, it } from "vitest";
import { tokenHash, tokenId } from "@chef/core/access";
import { mintGrant } from "../../src/grants.ts";
import { DEFAULT_SHARE_DAYS, isShareGrant, limited, sameTarget, mintShare, appScope, reaches, readShareRequest, scopeFor, sessionScope, targetOf, viewShare } from "../../src/shares.ts";

const DAY = 24 * 60 * 60_000;

describe("share links", () => {
  it("lets a session link read that session and its running app, and nothing else", async () => {
    const grant = await mintShare({ kind: "session", id: "s-1a2b", expiresAt: null }, { name: "Todo list", scopes: [sessionScope("shop", "s-1a2b"), appScope("shop", "s-1a2b")] }, 7);
    const { token } = grant;
    expect(grant).toMatchObject({ kind: "share", name: "Todo list", expiresAt: null, createdAt: 7 });
    expect(tokenId(token)).toBe(grant.id);
    expect(grant.hash).toBe(await tokenHash(token));
    expect(limited(grant)).toBe(true);
    for (const path of ["/api/projects/shop/sessions/s-1a2b", "/api/projects/shop/sessions/s-1a2b/turns", "/api/projects/shop/sessions/s-1a2b/changes", "/api/projects/shop/sessions/s-1a2b/events", "/app/shop/s-1a2b"]) expect(reaches(grant, "GET", path)).toBe(true);
    for (const [method, path] of [
      ["POST", "/api/projects/shop/sessions/s-1a2b/steer"],
      ["GET", "/api/projects/shop/sessions/s-1a2b/cloudflare"],
      ["GET", "/api/projects/shop/sessions/s-9999"],
      ["GET", "/api/projects/other/sessions/s-1a2b"],
      ["GET", "/app/shop/s-other"],
      ["GET", "/api/projects/shop/spec"],
      ["GET", "/api/keys"],
      ["GET", "/api/projects"],
      ["GET", "/agents/project/shop"],
    ] as const)
      expect(reaches(grant, method, path)).toBe(false);
    expect(targetOf(grant)).toEqual({ kind: "session", project: "shop", id: "s-1a2b" });
    expect(viewShare(grant, 9)).toMatchObject({ shareId: grant.id, token, kind: "session", project: "shop", id: "s-1a2b", lastUsedAt: 9 });
    expect(JSON.stringify(viewShare(grant, null))).not.toContain(grant.hash);
  });

  it("lets an app link open that app only", async () => {
    const grant = await mintShare({ kind: "app", id: "main", expiresAt: 5 }, { name: "", scopes: [appScope("shop", "main")] }, 1);
    expect(grant.name).toBe("main");
    expect(targetOf(grant)).toEqual({ kind: "app", project: "shop", id: "main" });
    expect(reaches(grant, "GET", "/app/shop/main")).toBe(true);
    expect(reaches(grant, "GET", "/api/projects/shop/sessions/s-1a2b")).toBe(false);
    expect(reaches(grant, "GET", "/api/projects/shop/sessions/s-1a2b/events")).toBe(false);
    expect(scopeFor("HEAD", "/app/shop/main")).toBeNull();
  });

  it("never treats a full key as a share link", async () => {
    const { grant } = await mintGrant({ name: "ci", kind: "key", expiresAt: null }, 1);
    expect(limited(grant)).toBe(false);
    expect(isShareGrant(grant)).toBe(false);
    expect(viewShare(grant, null)).toBeNull();
    expect(sameTarget(grant, { kind: "session", project: "shop", id: "s-1a2b" })).toBe(false);
  });

  it("tells links to the same build and kind apart from the rest", async () => {
    const session = await mintShare({ kind: "session", id: "s-1a2b", expiresAt: null }, { name: "Todo", scopes: [sessionScope("shop", "s-1a2b"), appScope("shop", "s-1a2b")] }, 1);
    const app = await mintShare({ kind: "app", id: "s-1a2b", expiresAt: null }, { name: "Todo", scopes: [appScope("shop", "s-1a2b")] }, 1);
    expect(sameTarget(session, { kind: "session", project: "shop", id: "s-1a2b" })).toBe(true);
    expect(sameTarget(session, { kind: "app", project: "shop", id: "s-1a2b" })).toBe(false);
    expect(sameTarget(app, { kind: "app", project: "shop", id: "s-1a2b" })).toBe(true);
    expect(sameTarget(app, { kind: "app", project: "other", id: "s-1a2b" })).toBe(false);
    const { token: _token, ...hashedOnly } = session;
    expect(isShareGrant(hashedOnly as never)).toBe(false);
  });

  it("reads a share request, with a month as the default lifetime", () => {
    expect(readShareRequest({ kind: "session", id: "s-1a2b" }, 0)).toEqual({ kind: "session", id: "s-1a2b", expiresAt: DEFAULT_SHARE_DAYS * DAY });
    expect(readShareRequest({ kind: "app", id: "s-1", expiresInDays: null }, 0)).toEqual({ kind: "app", id: "s-1", expiresAt: null });
    expect(readShareRequest({ kind: "app", id: "main", expiresInDays: 7 }, 10)).toEqual({ kind: "app", id: "main", expiresAt: 10 + 7 * DAY });
    for (const bad of [null, {}, { kind: "project", id: "x" }, { kind: "session", id: "" }, { kind: "session", id: "../keys" }, { kind: "app", id: "Main" }, { kind: "preview", id: "todo" }, { kind: "session", id: "s", expiresInDays: 0 }, { kind: "session", id: "s", expiresInDays: 400 }]) {
      expect(typeof readShareRequest(bad, 0)).toBe("string");
    }
  });
});
