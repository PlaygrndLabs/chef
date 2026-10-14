import { describe, expect, it } from "vitest";
import { tokenHash, tokenId } from "@chef/core/access";
import { mintGrant } from "../../src/grants.ts";
import { DEFAULT_SHARE_DAYS, limited, mintShare, previewScope, reaches, readShareRequest, scopeFor, sessionScope, targetOf, viewShare } from "../../src/shares.ts";

const DAY = 24 * 60 * 60_000;

describe("share links", () => {
  it("lets a session link read that session and its preview, and nothing else", async () => {
    const { grant, token } = await mintShare({ kind: "session", id: "s-1a2b", expiresAt: null }, { name: "Todo list", scopes: [sessionScope("shop", "s-1a2b"), previewScope("shop", "todo-list--s-1a2b")] }, 7);
    expect(grant).toMatchObject({ kind: "share", name: "Todo list", expiresAt: null, createdAt: 7 });
    expect(tokenId(token)).toBe(grant.id);
    expect(grant.hash).toBe(await tokenHash(token));
    expect(limited(grant)).toBe(true);
    for (const path of ["/api/projects/shop/sessions/s-1a2b", "/api/projects/shop/sessions/s-1a2b/turns", "/api/projects/shop/sessions/s-1a2b/changes", "/preview/shop/todo-list--s-1a2b"]) expect(reaches(grant, "GET", path)).toBe(true);
    for (const [method, path] of [
      ["POST", "/api/projects/shop/sessions/s-1a2b/steer"],
      ["GET", "/api/projects/shop/sessions/s-1a2b/cloudflare"],
      ["GET", "/api/projects/shop/sessions/s-9999"],
      ["GET", "/api/projects/other/sessions/s-1a2b"],
      ["GET", "/preview/shop/other-feature"],
      ["GET", "/api/projects/shop/spec"],
      ["GET", "/api/keys"],
      ["GET", "/api/projects"],
      ["GET", "/agents/project/shop"],
    ] as const)
      expect(reaches(grant, method, path)).toBe(false);
    expect(targetOf(grant)).toEqual({ kind: "session", project: "shop", id: "s-1a2b" });
    expect(viewShare(grant, 9)).toMatchObject({ shareId: grant.id, kind: "session", project: "shop", id: "s-1a2b", lastUsedAt: 9 });
    expect(JSON.stringify(viewShare(grant, null))).not.toContain(grant.hash);
  });

  it("lets a preview link open that preview only", async () => {
    const { grant } = await mintShare({ kind: "preview", id: "todo-list", expiresAt: 5 }, { name: "", scopes: [previewScope("shop", "todo-list")] }, 1);
    expect(grant.name).toBe("todo-list");
    expect(targetOf(grant)).toEqual({ kind: "preview", project: "shop", id: "todo-list" });
    expect(reaches(grant, "GET", "/preview/shop/todo-list")).toBe(true);
    expect(reaches(grant, "GET", "/api/projects/shop/sessions/s-1a2b")).toBe(false);
    expect(scopeFor("HEAD", "/preview/shop/todo-list")).toBeNull();
  });

  it("never treats a full key as a share link", async () => {
    const { grant } = await mintGrant({ name: "ci", kind: "key", expiresAt: null }, 1);
    expect(limited(grant)).toBe(false);
    expect(viewShare(grant, null)).toBeNull();
  });

  it("reads a share request, with a month as the default lifetime", () => {
    expect(readShareRequest({ kind: "session", id: "s-1a2b" }, 0)).toEqual({ kind: "session", id: "s-1a2b", expiresAt: DEFAULT_SHARE_DAYS * DAY });
    expect(readShareRequest({ kind: "preview", id: "todo-list--s-1", expiresInDays: null }, 0)).toEqual({ kind: "preview", id: "todo-list--s-1", expiresAt: null });
    expect(readShareRequest({ kind: "preview", id: "todo", expiresInDays: 7 }, 10)).toEqual({ kind: "preview", id: "todo", expiresAt: 10 + 7 * DAY });
    for (const bad of [null, {}, { kind: "project", id: "x" }, { kind: "session", id: "" }, { kind: "session", id: "../keys" }, { kind: "preview", id: "Todo" }, { kind: "session", id: "s", expiresInDays: 0 }, { kind: "session", id: "s", expiresInDays: 400 }]) {
      expect(typeof readShareRequest(bad, 0)).toBe("string");
    }
  });
});
