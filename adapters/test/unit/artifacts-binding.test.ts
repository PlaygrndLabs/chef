import { describe, expect, it } from "vitest";
import { bindingControl, type ArtifactsBindingLike } from "../../src/artifacts.ts";

const disposable = <T extends object>(value: T, disposed: string[], name: string): T => Object.assign(value, { [Symbol.dispose]: () => void disposed.push(name) });

describe("reading through the Artifacts binding", () => {
  it("releases every result so the Durable Object can hibernate", async () => {
    const disposed: string[] = [];
    const commit = { hash: "c1", treeHash: "t1", parents: [], message: "m", author: { name: "a", email: "a@x" }, committer: { name: "a", email: "a@x" }, authoredAt: 1, committedAt: 1 };
    const handle = {
      readCommit: async () => disposable({ ...commit }, disposed, "commit"),
      readTree: async () => disposable([{ name: "a.txt", hash: "b1", type: "blob", mode: "100644" }], disposed, "tree"),
      log: async () => disposable([{ ...commit }], disposed, "log"),
      [Symbol.dispose]: () => void disposed.push("repo"),
    };
    const binding = { get: async () => handle } as unknown as ArtifactsBindingLike;
    const read = bindingControl(binding).read;
    expect((await read?.readCommit("r", "c1"))?.treeHash).toBe("t1");
    expect((await read?.readTree("r", "t1"))?.[0]?.name).toBe("a.txt");
    expect((await read?.log("r", "main", 1))?.[0]?.hash).toBe("c1");
    expect(disposed).toEqual(["commit", "repo", "tree", "repo", "log", "repo"]);
  });
});
