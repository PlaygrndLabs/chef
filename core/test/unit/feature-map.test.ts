import { describe, expect, it } from "vitest";
import { applyMapEdit, entryChanges, isMapRequest, MAP_PROMPT, mapAsSpec, mapChanges, mapProblems, placeMapped, readFeatureMap, renderMapOutline, START_FILE, stepsTo } from "../../src/features/index.ts";
import { applyChanges, type Tree } from "../../src/git/tree.ts";

const tree: Tree = {
  [START_FILE]: "Run pnpm dev and open http://localhost:5173.\n",
  ...entryChanges({ id: "projects", title: "Projects", path: "The start page lists them." }),
  ...entryChanges({ id: "projects/project-page", title: "Project page", path: "Open a project." }),
  ...entryChanges({ id: "projects/project-page/feature-list", title: "Feature list", path: "It is on the left." }),
  ...entryChanges({ id: "projects/project-page/feature-list/versions", title: "Versions", state: "wish", path: "Start a second version of a feature." }),
} as Tree;

describe("the feature map in .chef/features", () => {
  it("reads folders as features with their parent, title, state and path", () => {
    const map = readFeatureMap(tree);
    expect(map.start).toBe("Run pnpm dev and open http://localhost:5173.");
    expect(map.features.map((f) => [f.id, f.parent, f.title, f.state])).toEqual([
      ["projects", null, "Projects", "current"],
      ["projects/project-page", "projects", "Project page", "current"],
      ["projects/project-page/feature-list", "projects/project-page", "Feature list", "current"],
      ["projects/project-page/feature-list/versions", "projects/project-page/feature-list", "Versions", "wish"],
    ]);
    expect(stepsTo(map, "projects/project-page/feature-list").steps.map((s) => s.path)).toEqual(["The start page lists them.", "Open a project.", "It is on the left."]);
    expect(mapProblems(tree)).toEqual([]);
  });

  it("treats a folder with only a PATH.md as a feature named after its folder and flags the missing title", () => {
    const loose = { ".chef/features/sign-in/PATH.md": "Press Sign in.\n" };
    expect(readFeatureMap(loose).features[0]).toMatchObject({ id: "sign-in", title: "Sign in", state: "current", path: "Press Sign in." });
    expect(mapProblems(loose)).toEqual([".chef/features/sign-in: missing SPECS.md with a title"]);
  });

  it("places explored features by parent name, after their parents, without repeating known ones", () => {
    const placed = placeMapped(readFeatureMap(tree), {
      start: "ignored, the map already has a start",
      features: [
        { name: "Sharing", title: "Sharing", parent: "sessions", path: "Press Share." },
        { name: "sessions", title: "Session", parent: "feature-list", path: "Click a feature." },
        { name: "projects", title: "Projects again", parent: null, path: "" },
        { name: "loop-a", title: "Loop A", parent: "loop-b", path: "" },
        { name: "loop-b", title: "Loop B", parent: "loop-a", path: "" },
      ],
    });
    expect(placed.start).toBeUndefined();
    expect(placed.entries.map((e) => e.id)).toEqual(["projects/project-page/feature-list/sessions", "projects/project-page/feature-list/sessions/sharing", "loop-a", "loop-a/loop-b"]);
    const next = readFeatureMap(applyChanges(tree, mapChanges(placed)));
    expect(next.features.find((f) => f.name === "sharing")).toMatchObject({ title: "Sharing", state: "current", path: "Press Share." });
  });

  it("edits the map: add a wish, rename, move with its parts, and remove", () => {
    const added = applyMapEdit(tree, { kind: "add", parent: "projects", title: "Project settings" });
    if (!added.ok) throw new Error(added.error);
    expect(added.id).toBe("projects/project-settings");
    let next = applyChanges(tree, added.changes);
    expect(readFeatureMap(next).features.find((f) => f.id === "projects/project-settings")?.state).toBe("wish");
    const moved = applyMapEdit(next, { kind: "move", id: "projects/project-page/feature-list", parent: "projects" });
    if (!moved.ok) throw new Error(moved.error);
    next = applyChanges(next, moved.changes);
    expect(readFeatureMap(next).features.map((f) => f.id)).toContain("projects/feature-list/versions");
    expect(applyMapEdit(next, { kind: "move", id: "projects", parent: "projects/feature-list" })).toEqual({ ok: false, error: "a feature cannot go under itself or one of its own parts" });
    const removed = applyMapEdit(next, { kind: "remove", id: "projects/feature-list" });
    if (!removed.ok) throw new Error(removed.error);
    expect(readFeatureMap(applyChanges(next, removed.changes)).features.map((f) => f.id)).toEqual(["projects", "projects/project-page", "projects/project-settings"]);
  });

  it("gives routing a spec entry per mapped feature and an outline for the planner", () => {
    const specs = mapAsSpec(readFeatureMap(tree), new Set(["projects"]));
    expect(specs.map((s) => [s.id, s.parent, s.status])).toEqual([
      ["project-page", "projects", "merged"],
      ["feature-list", "project-page", "merged"],
      ["versions", "feature-list", "proposed"],
    ]);
    expect(renderMapOutline(readFeatureMap(tree))).toBe("- projects: Projects [current]\n  - project-page: Project page [current]\n    - feature-list: Feature list [current]\n      - versions: Versions [wish]");
  });

  it("knows a request to map the current features", () => {
    for (const text of [MAP_PROMPT, "/map", "Map the current features", "explore the repo and populate the feature list with its existing features"]) expect(isMapRequest(text)).toBe(true);
    for (const text of ["Add a feature list page", "Build the checkout feature", "map page with pins"]) expect(isMapRequest(text)).toBe(false);
  });
});
