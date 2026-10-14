import { describe, expect, it } from "vitest";
import { isPage } from "../../../../template/shared/http.ts";
import { addressPath, enterAt, entryPage, frameReport, isPagePath, loadView, pageChips, previewState, stateLink, step, visit, type FrameLoad, type Trail } from "../../src/lib/preview.ts";

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

  const start: FrameLoad = { started: 1000, checked: null, building: null, answered: null, loaded: null, error: null };
  const labels = (view: ReturnType<typeof loadView>) => view.steps.map((s) => `${s.state} ${s.label}`);

  it("shows a live app that answers quickly as opening, then loading its page", () => {
    const opening = loadView(start, 1400, { preview: false, path: "/notes" });
    expect(opening.phase).toBe("start");
    expect(opening.title).toBe("Opening the app");
    expect(labels(opening)).toEqual(["run Reach the app", "wait Open /notes"]);
    const page = loadView({ ...start, answered: 1500 }, 1700, { preview: false, path: "/notes" });
    expect(page.phase).toBe("page");
    expect(labels(page)).toEqual(["done Reach the app", "run Open /notes"]);
    expect(page.steps[0]?.took).toBe(500);
    expect(page.percent).toBeGreaterThan(opening.percent);
    expect(loadView({ ...start, answered: 1500, loaded: 1900 }, 5000, { preview: false, path: "/notes" })).toMatchObject({ phase: "done", percent: 100 });
  });

  it("says the app is waking up once its first answer takes a while", () => {
    const waking = loadView(start, 4000, { preview: false, path: "/" });
    expect(waking.title).toBe("Waking up the app");
    expect(labels(waking)).toEqual(["run Wake up the app", "wait Open /"]);
    expect(waking.slow).toBe(false);
    expect(labels(loadView({ ...start, answered: 5000 }, 5200, { preview: false, path: "/" }))).toEqual(["done Wake up the app", "run Open /"]);
    expect(loadView(start, 30_000, { preview: false, path: "/" }).slow).toBe(true);
  });

  it("walks a sleeping preview through its rebuild before opening it", () => {
    const building = loadView({ ...start, checked: 1200, building: { since: 900, until: null } }, 20_000, { preview: true, path: "/notes" });
    expect(building.phase).toBe("build");
    expect(building.title).toBe("Waking up this preview");
    expect(labels(building)).toEqual(["done Check the preview", "run Build it again from the latest commit", "wait Reach the app", "wait Open /notes"]);
    expect(building.percent).toBeLessThan(99);
    const built = loadView({ ...start, checked: 1200, building: { since: 900, until: 60_000 } }, 60_300, { preview: true, path: "/notes" });
    expect(built.phase).toBe("start");
    expect(labels(built)).toEqual(["done Check the preview", "done Build it again from the latest commit", "run Reach the app", "wait Open /notes"]);
    expect(built.percent).toBeGreaterThan(building.percent);
    expect(labels(loadView({ ...start, checked: 1100 }, 1200, { preview: true, path: "/" }))).toEqual(["done Check the preview", "run Reach the app", "wait Open /"]);
  });

  it("marks the step that failed and shows why", () => {
    const failed = loadView({ ...start, checked: 1200, building: { since: 1000, until: null }, error: "deploy failed" }, 9000, { preview: true, path: "/" });
    expect(failed).toMatchObject({ phase: "failed", detail: "deploy failed" });
    expect(labels(failed)).toEqual(["done Check the preview", "failed Build it again from the latest commit", "wait Reach the app", "wait Open /"]);
    expect(labels(loadView({ ...start, error: "offline" }, 9000, { preview: false, path: "/" }))).toEqual(["failed Wake up the app", "wait Open /"]);
    expect(labels(loadView({ ...start, error: "This feature has no preview yet." }, 2000, { preview: true, path: "/" }))).toEqual(["failed Check the preview", "wait Reach the app", "wait Open /"]);
  });

  it("reads the engine's preview state and asks for it on the preview's own link", () => {
    expect(previewState({ status: "ready", url: "https://p.example.workers.dev", commitId: "abc" })).toEqual({ status: "ready", url: "https://p.example.workers.dev" });
    expect(previewState({ status: "ready", url: "javascript:alert(1)" })).toBeNull();
    expect(previewState({ status: "ready", url: "https://p.example.workers.dev", enter: "https://p.example.workers.dev/__chef/enter?t=a.b&to=%2F" })).toEqual({ status: "ready", url: "https://p.example.workers.dev", enter: "https://p.example.workers.dev/__chef/enter?t=a.b&to=%2F" });
    expect(previewState({ status: "ready", url: "https://p.example.workers.dev", enter: "https://evil.example/__chef/enter" })).toEqual({ status: "ready", url: "https://p.example.workers.dev" });
    expect(previewState({ status: "ready", url: "https://" })).toBeNull();
    expect(enterAt("https://p.example.workers.dev/__chef/enter?t=a.b&to=%2F", "/todos?x=1")).toBe("https://p.example.workers.dev/__chef/enter?t=a.b&to=%2Ftodos%3Fx%3D1");
    expect(previewState({ status: "building", since: 1, elapsedMs: 4200 })).toEqual({ status: "building", elapsedMs: 4200 });
    expect(previewState({ status: "failed", error: "" })).toEqual({ status: "failed", error: "The preview could not start." });
    expect(previewState({ status: "missing" })).toEqual({ status: "missing" });
    expect(previewState("ready")).toBeNull();
    expect(stateLink("/preview/notes/abc", false)).toBe("/preview/notes/abc?state=1");
    expect(stateLink("/preview/notes/abc", true)).toBe("/preview/notes/abc?state=1&retry=1");
  });
});
