import { describe, expect, it } from "vitest";
import { newToken, tokenHash, tokenId } from "@chef/core/access";
import { allows, deploymentGrant, deploymentKey, live, mintGrant, readGrantRequest, viewGrant } from "../../src/grants.ts";

describe("grants", () => {
  it("makes keys that carry their own id and keeps only a hash of them", async () => {
    const { grant, token } = await mintGrant({ name: "ci", kind: "key", expiresAt: null }, 5);
    expect(token).toMatch(/^chef_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(tokenId(token)).toBe(grant.id);
    expect(grant.hash).toBe(await tokenHash(token));
    expect(JSON.stringify(grant)).not.toContain(token);
    expect(JSON.stringify(viewGrant(grant, "app", null))).not.toContain(grant.hash);
    expect(viewGrant(grant, "app", 9)).toMatchObject({ prefix: `chef_${grant.id}_`, source: "app", createdAt: 5, lastUsedAt: 9 });
  });

  it("gives every key full access for now, through the same scope check later keys will use", async () => {
    const { grant } = await mintGrant({ name: "ci", kind: "key", expiresAt: null }, 1);
    expect(grant.scopes).toEqual(["*"]);
    expect(allows(grant, "project:demo:read")).toBe(true);
    expect(allows({ ...grant, scopes: ["project:demo:read"] }, "project:demo:read")).toBe(true);
    expect(allows({ ...grant, scopes: ["project:demo:read"] }, "project:other:read")).toBe(false);
  });

  it("reads a key request and refuses names, kinds and lifetimes it cannot keep", () => {
    expect(readGrantRequest({ name: "  ci  " }, 0)).toEqual({ name: "ci", kind: "key", expiresAt: null });
    expect(readGrantRequest({ name: "site", kind: "controller", expiresInDays: 2 }, 0)).toEqual({ name: "site", kind: "controller", expiresAt: 2 * 24 * 60 * 60_000 });
    for (const bad of [null, {}, { name: " " }, { name: "x".repeat(61) }, { name: "a", kind: "root" }, { name: "a", expiresInDays: 0 }, { name: "a", expiresInDays: 1.5 }, { name: "a", expiresInDays: 400 }]) {
      expect(typeof readGrantRequest(bad, 0)).toBe("string");
    }
  });

  it("treats the deployment's CHEF_API_KEY as a managing app's key, and ignores a value that is not a key", async () => {
    const { id, token } = newToken();
    expect(deploymentKey({})).toBeNull();
    expect(deploymentKey({ CHEF_API_KEY: "a password" })).toBeNull();
    expect(deploymentKey({ CHEF_API_KEY: ` ${token} ` })).toBe(token);
    expect(await deploymentGrant(token)).toMatchObject({ id, kind: "controller", scopes: ["*"], expiresAt: null });
  });

  it("lets a key in only until it runs out", async () => {
    const { grant } = await mintGrant({ name: "ci", kind: "key", expiresAt: 10 }, 1);
    expect(live(grant, 9)).toBe(true);
    expect(live(grant, 10)).toBe(false);
    expect(live({ ...grant, expiresAt: null }, Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
