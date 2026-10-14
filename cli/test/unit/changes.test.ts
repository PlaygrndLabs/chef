import { describe, expect, it } from "vitest";
import { changeOf, changes, parseLog, shapesChef, type Commit } from "../../src/changes.ts";
import { REPO_ROOT } from "../../src/world.ts";

const commit = (subject: string, files: readonly string[], body = ""): Commit => ({ sha: "0123456789abcdef0123", date: "2026-10-14T21:00:00+00:00", subject, body, files });

describe("changes", () => {
  it("counts only changes to the code a running Chef is built from", () => {
    expect(shapesChef("apps/dashboard/src/app.tsx")).toBe(true);
    expect(shapesChef("workers/src/index.ts")).toBe(true);
    expect(shapesChef("wrangler.jsonc")).toBe(true);
    expect(shapesChef("core/test/router.test.ts")).toBe(false);
    expect(shapesChef("apps/dashboard/src/view.test.tsx")).toBe(false);
    expect(shapesChef("docs/ARCHITECTURE.md")).toBe(false);
    expect(shapesChef("cli/src/bench/run.ts")).toBe(false);
  });

  it("names each change by its pull request title", () => {
    expect(changeOf(commit("Preview works like a small browser (#158)", ["apps/dashboard/src/preview.tsx"]))).toEqual({ version: "0123456789ab", date: "2026-10-14", title: "Preview works like a small browser", pr: 158 });
    expect(changeOf(commit("Merge pull request #157 from someone/branch", ["core/src/a.ts"], "Let people leave an unfinished setup.\n\nMore words"))).toMatchObject({ title: "Let people leave an unfinished setup", pr: 157 });
    expect(changeOf(commit("Fix the build", ["workers/src/a.ts"]))).toMatchObject({ title: "Fix the build", pr: null });
    expect(changeOf(commit("Take the hosted site out of chef, keep `chef deploy` and chef-dev (#159)", ["apps/a.ts"]))).toMatchObject({ title: "Take the hosted site out of Chef, keep `chef deploy` and chef-dev" });
    expect(changeOf(commit("Write the architecture down (#90)", ["docs/ARCHITECTURE.md", "core/test/a.test.ts"]))).toBeNull();
  });

  it("reads git's log records", () => {
    const log = "\x1eabc\x1f2026-10-14T21:00:00+00:00\x1fOne (#1)\x1f\x1f\n\napps/a.ts\ndocs/b.md\n\x1edef\x1f2026-10-13T08:00:00+00:00\x1fTwo\x1fbody\nline\x1f\n\ncore/src/c.ts\n";
    expect(parseLog(log)).toEqual([
      { sha: "abc", date: "2026-10-14T21:00:00+00:00", subject: "One (#1)", body: "", files: ["apps/a.ts", "docs/b.md"] },
      { sha: "def", date: "2026-10-13T08:00:00+00:00", subject: "Two", body: "body\nline", files: ["core/src/c.ts"] },
    ]);
  });

  it("lists this checkout's changes newest first", () => {
    const listed = changes(REPO_ROOT, 3);
    expect(listed.length).toBeLessThanOrEqual(3);
    for (const change of listed) expect(change.version).toMatch(/^[0-9a-f]{12}$/);
  });
});
