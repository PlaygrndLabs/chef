import { describe, expect, it } from "vitest";
import { applyChanges, diffTrees, threeWayMerge } from "../../src/git/tree.ts";

describe("trees", () => {
  it("applies and diffs changes", () => {
    const next = applyChanges({ a: "1", b: "2" }, { b: null, c: "3" });
    expect(next).toEqual({ a: "1", c: "3" });
    expect(diffTrees({ a: "1", b: "2" }, next)).toEqual({ b: null, c: "3" });
  });

  it("merges files changed on one side", () => {
    expect(threeWayMerge({ a: "1" }, { a: "1", b: "x" }, { a: "2" })).toEqual({ tree: { a: "2", b: "x" }, conflicts: [] });
  });

  it("merges edits to different lines of the same file", () => {
    const base = "one\ntwo\nthree\nfour\nfive";
    const ours = "ONE\ntwo\nthree\nfour\nfive";
    const theirs = "one\ntwo\nthree\nfour\nFIVE";
    expect(threeWayMerge({ f: base }, { f: ours }, { f: theirs })).toEqual({ tree: { f: "ONE\ntwo\nthree\nfour\nFIVE" }, conflicts: [] });
  });

  it("reports a conflict when both sides edit the same line", () => {
    expect(threeWayMerge({ f: "a\nb" }, { f: "x\nb" }, { f: "y\nb" }).conflicts).toEqual(["f"]);
  });

  it("uses a resolver for conflicts and regenerates generated files", () => {
    const gen = ({ merged }: { merged: Record<string, string> }) => Object.keys(merged).filter((k) => k !== "gen").join(",");
    const result = threeWayMerge({ gen: "" }, { gen: "a", a: "1" }, { gen: "b", b: "1" }, { gen });
    expect(result).toEqual({ tree: { a: "1", b: "1", gen: "a,b" }, conflicts: [] });
  });
});
