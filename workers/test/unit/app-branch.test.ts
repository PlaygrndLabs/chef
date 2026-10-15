import { describe, expect, it } from "vitest";
import { appBranch } from "../../src/app-host.ts";

const session = (id: string, state: string, extra: { into?: string; forkDeleted?: boolean; head?: string | null } = {}) => ({
  id,
  fork: `shop--${id}`,
  head: extra.head === undefined ? `${id}-head` : extra.head,
  forkDeleted: extra.forkDeleted ?? false,
  machine: { state },
  merge: state === "merged" ? { commitId: "m", mainBefore: "b", ...(extra.into ? { into: extra.into } : {}) } : null,
}) as unknown as Parameters<typeof appBranch>[0][number];

describe("app branch", () => {
  it("opens main's app for a build merged into main, even before its fork is deleted", () => {
    expect(appBranch([session("s1", "merged")], "s1")).toEqual({ kind: "main" });
    expect(appBranch([session("s1", "merged", { forkDeleted: true })], "s1")).toEqual({ kind: "main" });
  });

  it("opens the parent's app for a build merged into a parent build", () => {
    expect(appBranch([session("child", "merged", { into: "parent" }), session("parent", "coding")], "child")).toEqual({ kind: "session", id: "parent", fork: "shop--parent", head: "parent-head" });
    expect(appBranch([session("child", "merged", { into: "parent" }), session("parent", "merged")], "child")).toEqual({ kind: "main" });
  });

  it("opens a running build's own app, and none for a build without a commit or fork", () => {
    expect(appBranch([session("s1", "coding")], "s1")).toEqual({ kind: "session", id: "s1", fork: "shop--s1", head: "s1-head" });
    expect(appBranch([session("s1", "coding", { head: null })], "s1")).toBeNull();
    expect(appBranch([session("s1", "dropped", { forkDeleted: true })], "s1")).toBeNull();
    expect(appBranch([], "s1")).toBeNull();
  });
});
