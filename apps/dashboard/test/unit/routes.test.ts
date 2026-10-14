import { describe, expect, it } from "vitest";
import { isPage as appIsPage } from "../../../../template/shared/http.ts";
import { isPage, pagesFor, type Route } from "../../src/lib/routes.ts";

const notesFeature: Route[] = [
  { method: "GET", path: "/" },
  { method: "GET", path: "/delete-note/client.js" },
  { method: "GET", path: "/notes" },
  { method: "GET", path: "/api/notes" },
  { method: "POST", path: "/api/notes" },
  { method: "DELETE", path: "/api/notes/:id" },
  { method: "DELETE", path: "/api/notes/no-such-note-id" },
];

describe("preview pages", () => {
  it("lists only pages a browser opens, not scripts or API routes", () => {
    expect(pagesFor(notesFeature, "delete-note").map((r) => r.path)).toEqual(["/notes"]);
  });

  it("opens the feature's entrypoint first, then its own pages", () => {
    const routes: Route[] = [
      { method: "GET", path: "/notes" },
      { method: "GET", path: "/todos/done" },
      { method: "GET", path: "/todos" },
    ];
    expect(pagesFor(routes, "todos").map((r) => r.path)).toEqual(["/todos", "/todos/done", "/notes"]);
    expect(pagesFor(routes, "todos", { method: "GET", path: "/notes" }).map((r) => r.path)).toEqual(["/notes", "/todos", "/todos/done"]);
    expect(pagesFor(routes, "todo").map((r) => r.path)).toEqual(["/notes", "/todos", "/todos/done"]);
  });

  it("agrees with the app's own list of pages", () => {
    const routes: Route[] = [...notesFeature, { method: "GET", path: "/api" }, { method: "GET", path: "/style.css" }, { method: "GET", path: "/notes/archive" }, { method: "GET", path: "/v1.2/notes" }];
    for (const route of routes) expect(isPage(route), `${route.method} ${route.path}`).toBe(appIsPage(route as Parameters<typeof appIsPage>[0]));
  });
});
