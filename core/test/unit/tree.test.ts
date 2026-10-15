import { describe, expect, it } from "vitest";
import { applyChanges, conflictMarkers, diffTrees, threeWayMerge } from "../../src/git/tree.ts";

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

  it("merges edits far apart in a large file quickly and in little memory", () => {
    const base = Array.from({ length: 20_000 }, (_, i) => `"pkg-${i}": "1.${i}.0",`);
    const ours = [...base.slice(0, 10), `"added-a": "1.0.0",`, ...base.slice(10)];
    const theirs = [...base.slice(0, 19_990), `"added-b": "1.0.0",`, ...base.slice(19_990)];
    const started = Date.now();
    const merged = threeWayMerge({ f: base.join("\n") }, { f: ours.join("\n") }, { f: theirs.join("\n") });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(merged).toEqual({ tree: { f: [...base.slice(0, 10), `"added-a": "1.0.0",`, ...base.slice(10, 19_990), `"added-b": "1.0.0",`, ...base.slice(19_990)].join("\n") }, conflicts: [] });
  });

  it("treats a rewrite with too many edits to diff as one change", () => {
    const base = Array.from({ length: 3000 }, (_, i) => `old ${i}`);
    const ours = base.map((_, i) => `new ${i}`);
    const theirs = [...base.slice(0, 1500), "theirs", ...base.slice(1500)];
    const started = Date.now();
    expect(threeWayMerge({ f: base.join("\n") }, { f: ours.join("\n") }, { f: theirs.join("\n") }).conflicts).toEqual(["f"]);
    expect(conflictMarkers(base.join("\n"), ours.join("\n"), base.join("\n"))).toBe(ours.join("\n"));
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("rebuilds any edited file from its line diff", () => {
    let seed = 7;
    const random = (below: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % below;
    };
    for (let round = 0; round < 200; round++) {
      const base = Array.from({ length: random(80) }, () => `line ${random(6)}`);
      const next = [...base];
      for (let n = random(12); n > 0; n--) {
        const at = random(next.length + 1);
        if (random(3) === 0) next.splice(at, 1);
        else if (random(2)) next.splice(at, 1, `new ${random(6)}`);
        else next.splice(at, 0, `line ${random(6)}`);
      }
      expect(conflictMarkers(base.join("\n"), next.join("\n"), base.join("\n"))).toBe(next.join("\n"));
    }
  });

  it("uses a resolver for conflicts and regenerates generated files", () => {
    const gen = ({ merged }: { merged: Record<string, string> }) => Object.keys(merged).filter((k) => k !== "gen").join(",");
    const result = threeWayMerge({ gen: "" }, { gen: "a", a: "1" }, { gen: "b", b: "1" }, { gen });
    expect(result).toEqual({ tree: { a: "1", b: "1", gen: "a,b" }, conflicts: [] });
  });
});

describe("conflict markers", () => {
  it("marks only the overlapping hunk and keeps clean hunks from both sides", () => {
    const base = ["export const menu = [", '  "home",', "];", "", "export const title = \"app\";"].join("\n");
    const ours = ["export const menu = [", '  "home",', '  "notes",', "];", "", "export const title = \"app\";"].join("\n");
    const theirs = ["export const menu = [", '  "home",', '  "tags",', "];", "", "export const title = \"chef\";"].join("\n");
    expect(conflictMarkers(base, ours, theirs)).toBe(
      ["export const menu = [", '  "home",', "<<<<<<< session", '  "notes",', "=======", '  "tags",', ">>>>>>> main", "];", "", "export const title = \"chef\";"].join("\n"),
    );
  });

  it("writes no markers when both sides made the same change", () => {
    expect(conflictMarkers("a\nb", "a\nc", "a\nc")).toBe("a\nc");
  });
});
