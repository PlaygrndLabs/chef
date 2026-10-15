import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp, json, type Feature } from "./http.ts";
import { MemoryStore } from "./storage.ts";

const notes: Feature = {
  id: "notes",
  title: "Notes",
  routes: [
    { method: "GET", path: "/notes", handle: () => new Response("<p>notes</p>", { headers: { "content-type": "text/html" } }) },
    { method: "GET", path: "/api/notes", handle: () => json([]) },
    { method: "GET", path: "/notes/:id", handle: () => json({}) },
  ],
};

test("a browser opening / gets a page that links every feature page", async () => {
  const app = createApp([notes], new MemoryStore());
  const response = await app(new Request("http://app.test/", { headers: { accept: "text/html,application/xhtml+xml" } }));
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  assert.match(html, /<a [^>]*href="\/notes"[^>]*>.*Notes.*<\/a>/);
  assert.doesNotMatch(html, /\/api\/notes|:id/);
});

test("API clients opening / get the list of pages", async () => {
  const app = createApp([notes], new MemoryStore());
  const response = await app(new Request("http://app.test/"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, pages: ["/notes"] });
});

test("scripts, styles and other files a page loads are not pages", async () => {
  const deleteNote: Feature = {
    id: "delete-note",
    title: "Delete a note",
    routes: [
      { method: "GET", path: "/delete-note/client.js", handle: () => new Response("", { headers: { "content-type": "text/javascript" } }) },
      { method: "GET", path: "/delete-note/style.css", handle: () => new Response("") },
      { method: "DELETE", path: "/api/notes/:id", handle: () => json({}) },
    ],
  };
  const app = createApp([notes, deleteNote], new MemoryStore());
  assert.deepEqual(await (await app(new Request("http://app.test/"))).json(), { ok: true, pages: ["/notes"] });
});

test("every page tells the Chef frame around it which page is open and which pages exist", async () => {
  const app = createApp([notes], new MemoryStore());
  const page = await (await app(new Request("http://app.test/notes"))).text();
  assert.match(page, /^<p>notes<\/p><script>.*postMessage\(\{chef:"page",path:location\.pathname\+location\.search,title:document\.title,pages:\[\{"title":"Notes","path":"\/notes"\}\]\}/);
  assert.deepEqual(await (await app(new Request("http://app.test/api/notes"))).json(), []);
  const titled: Feature = { id: "x", title: "</script><b>", routes: [{ method: "GET", path: "/x", handle: () => new Response("<body></body>", { headers: { "content-type": "text/html" } }) }] };
  const escaped = await (await createApp([titled], new MemoryStore())(new Request("http://app.test/x"))).text();
  assert.doesNotMatch(escaped, /<\/script><b>/);
  assert.match(escaped, /<\/script><\/body>$/);
});

test("an app with no features still answers on /", async () => {
  const app = createApp([], new MemoryStore());
  assert.equal((await app(new Request("http://app.test/"))).status, 200);
  assert.match(await (await app(new Request("http://app.test/", { headers: { accept: "text/html" } }))).text(), /No pages yet/);
});

test("a feature that serves its own / page keeps it", async () => {
  const landing: Feature = { id: "landing", title: "Landing", routes: [{ method: "GET", path: "/", handle: () => new Response("landing") }] };
  const app = createApp([landing, notes], new MemoryStore());
  const response = await app(new Request("http://app.test/", { headers: { accept: "text/html" } }));
  assert.equal(await response.text(), "landing");
});

test("routes read keys and settings from context.env", async () => {
  const weather: Feature = { id: "weather", title: "Weather", routes: [{ method: "GET", path: "/api/weather", handle: (_request, context) => json({ configured: Boolean(context.env["WEATHER_API_KEY"]) }) }] };
  assert.deepEqual(await (await createApp([weather], new MemoryStore(), { WEATHER_API_KEY: "test" })(new Request("http://app.test/api/weather"))).json(), { configured: true });
  assert.deepEqual(await (await createApp([weather], new MemoryStore())(new Request("http://app.test/api/weather"))).json(), { configured: false });
});

test("a browser opening a page no feature serves yet gets a friendly page that links the app's pages", async () => {
  const app = createApp([notes], new MemoryStore());
  const response = await app(new Request("http://app.test/reading-list", { headers: { accept: "text/html,application/xhtml+xml" } }));
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  assert.match(html, /<title>This page isn&#39;t built yet<\/title>/);
  assert.match(html, /<code>\/reading-list<\/code>/);
  assert.match(html, /<a [^>]*href="\/"/);
  assert.match(html, /<a [^>]*href="\/notes"/);
  assert.match(html, /postMessage\(\{chef:"page"/);
});

test("API clients and unknown API paths still get a JSON 404", async () => {
  const app = createApp([notes], new MemoryStore());
  for (const request of [new Request("http://app.test/reading-list"), new Request("http://app.test/api/books", { headers: { accept: "text/html" } }), new Request("http://app.test/reading-list", { method: "POST", headers: { accept: "text/html" } })]) {
    const response = await app(request);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not found" });
  }
});
