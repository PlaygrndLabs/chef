import assert from "node:assert/strict";
import { test } from "node:test";
import { staticPages } from "./meta.ts";

const pages = [
  { path: "/notes", title: "Notes", nav: true },
  { path: "/about", title: "About", description: "Who we are" },
  { path: "/notes/:id", title: "Note" },
  { path: "/export.csv", title: "Export" },
];

test("each fixed page gets its title and description, and / gets the app's", () => {
  const found = staticPages(pages, { brand: "Jot", description: "Quick notes" });
  assert.deepEqual(Object.fromEntries(found), {
    "/": { title: "Jot", description: "Quick notes" },
    "/notes": { title: "Notes · Jot", description: "Quick notes" },
    "/about": { title: "About · Jot", description: "Who we are" },
  });
});

test("without a brand, / is named after the page it opens", () => {
  assert.deepEqual(staticPages(pages, {}).get("/"), { title: "Notes" });
});

test("a page whose address a GET route also answers is left to the route", () => {
  const found = staticPages(pages, {}, ["/about", "/"]);
  assert.deepEqual([...found.keys()], ["/notes"]);
});

test("an app with no pages yet gets nothing", () => {
  assert.equal(staticPages([], { brand: "Jot" }).size, 0);
});
