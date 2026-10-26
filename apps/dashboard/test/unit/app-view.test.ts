import { describe, expect, it } from "vitest";
import { isPage } from "../../../../template/shared/http.ts";
import { addressPath, appLink, appState, builtPage, enterAt, entryPage, frameKey, frameReport, frameUrl, isPagePath, loadView, NO_STACK, stateLink, step, visit, type FrameLoad, type Trail } from "../../src/lib/app-view.ts";

describe("app browser", () => {
  it("keeps the app frame while its app only starts or wakes, and loads it again for a new commit or after a failure", () => {
    expect(frameKey({ status: "starting", commitId: "c1" })).toBe(frameKey({ status: "running", commitId: "c1" }));
    expect(frameKey({ status: "running", commitId: "c2" })).not.toBe(frameKey({ status: "running", commitId: "c1" }));
    expect(frameKey({ status: "failed", commitId: "c1" })).not.toBe(frameKey({ status: "starting", commitId: "c1" }));
    expect(frameKey({ status: "no-stack", commitId: "c1" })).not.toBe(frameKey({ status: "running", commitId: "c1" }));
  });

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

  it("moves inside a loaded app straight on its own address", () => {
    expect(frameUrl("https://main-notes.example.dev/", "/notes?tab=2")).toBe("https://main-notes.example.dev/notes?tab=2");
    expect(frameUrl("https://main-notes.example.dev", "about")).toBe("https://main-notes.example.dev/about");
  });

  const start: FrameLoad = { started: 1000, checked: null, starting: null, answered: null, loaded: null, error: null };
  const labels = (view: ReturnType<typeof loadView>) => view.steps.map((s) => `${s.state} ${s.label}`);

  it("shows a running app that answers quickly as opening, then loading its page", () => {
    const opening = loadView({ ...start, checked: 1100 }, 1400, { path: "/notes" });
    expect(opening.phase).toBe("reach");
    expect(opening.title).toBe("Opening the app");
    expect(labels(opening)).toEqual(["done Check the app", "run Reach the app", "wait Open /notes"]);
    const page = loadView({ ...start, checked: 1100, answered: 1500 }, 1700, { path: "/notes" });
    expect(page.phase).toBe("page");
    expect(labels(page)).toEqual(["done Check the app", "done Reach the app", "run Open /notes"]);
    expect(page.steps[1]?.took).toBe(400);
    expect(page.percent).toBeGreaterThan(opening.percent);
    expect(loadView({ ...start, checked: 1100, answered: 1500, loaded: 1900 }, 5000, { path: "/notes" })).toMatchObject({ phase: "done", percent: 100 });
  });

  it("says the app is starting again once its first answer takes a while", () => {
    const waking = loadView({ ...start, checked: 1000 }, 4000, { path: "/" });
    expect(waking.title).toBe("Starting the app again");
    expect(labels(waking)).toEqual(["done Check the app", "run Start the app again", "wait Open /"]);
    expect(waking.slow).toBe(false);
    expect(labels(loadView({ ...start, checked: 1000, answered: 5000 }, 5200, { path: "/" }))).toEqual(["done Check the app", "done Start the app again", "run Open /"]);
    expect(loadView({ ...start, checked: 1000 }, 30_000, { path: "/" }).slow).toBe(true);
  });

  it("walks an app through its start in the sandbox before opening it", () => {
    const starting = loadView({ ...start, checked: 1200, starting: { since: 900, until: null } }, 20_000, { path: "/notes" });
    expect(starting.phase).toBe("start");
    expect(starting.title).toBe("Starting the app");
    expect(labels(starting)).toEqual(["done Check the app", "run Start the app from the latest commit", "wait Reach the app", "wait Open /notes"]);
    expect(starting.percent).toBeLessThan(99);
    const started = loadView({ ...start, checked: 1200, starting: { since: 900, until: 60_000 } }, 60_300, { path: "/notes" });
    expect(started.phase).toBe("reach");
    expect(labels(started)).toEqual(["done Check the app", "done Start the app from the latest commit", "run Reach the app", "wait Open /notes"]);
    expect(started.percent).toBeGreaterThan(starting.percent);
    expect(labels(loadView({ ...start, checked: 1100 }, 1200, { path: "/" }))).toEqual(["done Check the app", "run Reach the app", "wait Open /"]);
  });

  it("marks the step that failed and shows why", () => {
    const failed = loadView({ ...start, checked: 1200, starting: { since: 1000, until: null }, error: "compose up failed" }, 9000, { path: "/" });
    expect(failed).toMatchObject({ phase: "failed", detail: "compose up failed" });
    expect(labels(failed)).toEqual(["done Check the app", "failed Start the app from the latest commit", "wait Reach the app", "wait Open /"]);
    expect(labels(loadView({ ...start, checked: 1000, error: "offline" }, 9000, { path: "/" }))).toEqual(["done Check the app", "failed Start the app again", "wait Open /"]);
    expect(labels(loadView({ ...start, error: "There is no app here yet." }, 2000, { path: "/" }))).toEqual(["failed Check the app", "wait Reach the app", "wait Open /"]);
  });

  it("explains that a branch without a compose file has no app to run", () => {
    const view = loadView({ ...start, checked: 1300, noStack: true }, 9000, { path: "/" });
    expect(view).toMatchObject({ phase: "no-stack", title: "This branch has no app to run", detail: NO_STACK, percent: 100, slow: false });
    expect(view.detail).toContain("compose.yaml");
    expect(labels(view)).toEqual(["done Check the app", "failed Find a wrangler config or compose file"]);
  });

  it("reads the engine's app state and asks for it on the app's own link", () => {
    expect(appState({ status: "ready", url: "https://a.example.workers.dev", commitId: "abc" })).toEqual({ status: "ready", url: "https://a.example.workers.dev" });
    expect(appState({ status: "ready", url: "javascript:alert(1)" })).toBeNull();
    expect(appState({ status: "ready", url: "https://a.example.workers.dev", enter: "https://a.example.workers.dev/__chef/enter?t=a.b&to=%2F" })).toEqual({ status: "ready", url: "https://a.example.workers.dev", enter: "https://a.example.workers.dev/__chef/enter?t=a.b&to=%2F" });
    expect(appState({ status: "ready", url: "https://a.example.workers.dev", enter: "https://evil.example/__chef/enter" })).toEqual({ status: "ready", url: "https://a.example.workers.dev" });
    expect(appState({ status: "ready", url: "https://" })).toBeNull();
    expect(enterAt("https://a.example.workers.dev/__chef/enter?t=a.b&to=%2F", "/todos?x=1")).toBe("https://a.example.workers.dev/__chef/enter?t=a.b&to=%2Ftodos%3Fx%3D1");
    expect(appState({ status: "starting", since: 1, elapsedMs: 4200 })).toEqual({ status: "starting", elapsedMs: 4200 });
    expect(appState({ status: "building", elapsedMs: 4200 })).toBeNull();
    expect(appState({ status: "failed", error: "" })).toEqual({ status: "failed", error: "The app could not start." });
    expect(appState({ status: "no-stack" })).toEqual({ status: "no-stack" });
    expect(appState({ status: "missing" })).toEqual({ status: "missing" });
    expect(appState("ready")).toBeNull();
    expect(appLink("notes", "s-1")).toBe("/app/notes/s-1");
    expect(appLink("notes", "main")).toBe("/app/notes/main");
    expect(stateLink("/app/notes/s-1", false)).toBe("/app/notes/s-1?state=1");
    expect(stateLink("/app/notes/main", true)).toBe("/app/notes/main?state=1&retry=1");
  });

  it("moves on to a build's own page only once the app lists it", () => {
    const home = (pages: readonly string[]) => ({ path: "/", title: "Home", pages: pages.map((path) => ({ path, title: "" })) });
    expect(builtPage("/reading-list", home(["/"]), "/")).toBeNull();
    expect(builtPage("/reading-list", home(["/", "/reading-list"]), "/")).toBe("/reading-list");
    expect(builtPage("/reading-list", { ...home(["/reading-list"]), path: "/other" }, "/")).toBeNull();
    expect(builtPage(null, home(["/reading-list"]), "/")).toBeNull();
  });
});
