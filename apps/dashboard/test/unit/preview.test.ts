import { describe, expect, it } from "vitest";
import { isPage } from "../../../../template/shared/http.ts";
import { addressPath, entryPage, frameReport, isPagePath, pageChips, step, visit, type Trail } from "../../src/lib/preview.ts";

describe("preview browser", () => {
  it("opens the page named in the feature's entrypoint, never a script or an API", () => {
    expect(entryPage("GET /notes")).toBe("/notes");
    expect(entryPage("/notes")).toBe("/notes");
    expect(entryPage("POST /api/notes")).toBeNull();
    expect(entryPage("GET /delete-note/client.js")).toBeNull();
    expect(entryPage("GET /notes/:id")).toBeNull();
    expect(entryPage("features/notes/index.ts")).toBeNull();
    expect(entryPage(undefined)).toBeNull();
  });

  it("calls a path a page exactly when the app does", () => {
    for (const path of ["/", "/notes", "/notes/archive", "/notes/:id", "/api", "/api/notes", "/delete-note/client.js", "/style.css", "/v1.2/notes"]) {
      expect(isPagePath(path), path).toBe(isPage({ method: "GET", path }));
    }
  });

  it("reads only well formed page reports from the app", () => {
    expect(frameReport({ chef: "page", path: "/notes", title: "Notes", pages: [{ title: "Notes", path: "/notes" }, { path: 3 }] })).toEqual({ path: "/notes", title: "Notes", pages: [{ title: "Notes", path: "/notes" }] });
    expect(frameReport({ chef: "other", path: "/notes", pages: [] })).toBeNull();
    expect(frameReport({ chef: "page", path: "notes", pages: [] })).toBeNull();
    expect(frameReport("page")).toBeNull();
  });

  it("turns what a person types into a path", () => {
    expect(addressPath("notes")).toBe("/notes");
    expect(addressPath(" /notes?tag=a ")).toBe("/notes?tag=a");
    expect(addressPath("https://x.workers.dev/notes/new?draft=1")).toBe("/notes/new?draft=1");
    expect(addressPath("")).toBe("/");
  });

  it("goes back and forward like a browser", () => {
    let trail: Trail = { entries: ["/notes"], index: 0 };
    trail = visit(trail, "/notes");
    expect(trail.entries).toEqual(["/notes"]);
    trail = visit(visit(trail, "/about"), "/help");
    trail = step(trail, -2);
    expect(trail.entries[trail.index]).toBe("/notes");
    expect(step(trail, -1)).toBe(trail);
    trail = visit(step(trail, 1), "/new");
    expect(trail).toEqual({ entries: ["/notes", "/about", "/new"], index: 2 });
  });

  it("lists home, the app's pages and the start page once each", () => {
    expect(pageChips([{ title: "Notes", path: "/notes" }], "/notes").map((p) => p.path)).toEqual(["/", "/notes"]);
    expect(pageChips([], "/notes").map((p) => p.path)).toEqual(["/", "/notes"]);
    expect(pageChips([], "/").map((p) => p.path)).toEqual(["/"]);
  });
});
