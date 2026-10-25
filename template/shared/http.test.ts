import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp, json, routeClashes, shellHtml, type Feature } from "./http.ts";
import { MemoryStore } from "./storage.ts";

const notes: Feature = {
  id: "notes",
  title: "Notes",
  routes: [
    { method: "GET", path: "/api/notes", handle: () => json([]) },
    { method: "GET", path: "/notes/:id", handle: () => json({}) },
  ],
};

test("a browser opening any page gets the app shell that loads the React client", async () => {
  const app = createApp([notes], new MemoryStore());
  for (const path of ["/", "/books", "/books/7?tab=2"]) {
    const response = await app(new Request(`http://app.test${path}`, { headers: { accept: "text/html,application/xhtml+xml" } }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /<div id="root"><\/div>/);
    assert.match(html, /<script type="module" src="\/client\.js"><\/script>/);
  }
});

test("API clients opening / get a short answer, so a fresh app answers from its first commit", async () => {
  const app = createApp([], new MemoryStore());
  const response = await app(new Request("http://app.test/"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("a feature route wins over the shell", async () => {
  const landing: Feature = { id: "landing", title: "Landing", routes: [{ method: "GET", path: "/", handle: () => new Response("landing") }] };
  const app = createApp([landing, notes], new MemoryStore());
  assert.equal(await (await app(new Request("http://app.test/", { headers: { accept: "text/html" } }))).text(), "landing");
  assert.deepEqual(await (await app(new Request("http://app.test/api/notes", { headers: { accept: "text/html" } }))).json(), []);
});

test("routes read keys and settings from context.env", async () => {
  const weather: Feature = { id: "weather", title: "Weather", routes: [{ method: "GET", path: "/api/weather", handle: (_request, context) => json({ configured: Boolean(context.env["WEATHER_API_KEY"]) }) }] };
  assert.deepEqual(await (await createApp([weather], new MemoryStore(), { WEATHER_API_KEY: "test" })(new Request("http://app.test/api/weather"))).json(), { configured: true });
  assert.deepEqual(await (await createApp([weather], new MemoryStore())(new Request("http://app.test/api/weather"))).json(), { configured: false });
});

test("API clients and unknown API paths still get a JSON 404", async () => {
  const app = createApp([notes], new MemoryStore());
  for (const request of [new Request("http://app.test/reading-list"), new Request("http://app.test/api/books", { headers: { accept: "text/html" } }), new Request("http://app.test/reading-list", { method: "POST", headers: { accept: "text/html" } })]) {
    const response = await app(request);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not found" });
  }
});

test("a route that throws answers with what went wrong instead of an empty error", async () => {
  const broken: Feature = {
    id: "broken",
    title: "Broken",
    routes: [
      {
        method: "POST",
        path: "/api/notes",
        handle: () => {
          throw new Error("storage is down");
        },
      },
    ],
  };
  const app = createApp([broken], new MemoryStore());
  const failed = await app(new Request("http://app.test/api/notes", { method: "POST", headers: { accept: "text/html" } }));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "The server failed while answering POST /api/notes: storage is down" });
});

test("two routes on the same method and path cannot both be in the app", () => {
  const guestbook: Feature = { id: "guestbook", title: "Guestbook", routes: [{ method: "POST", path: "/api/entries", handle: () => json({}) }, { method: "GET", path: "/api/entries/:id", handle: () => json({}) }] };
  const order: Feature = { id: "order", title: "Order", routes: [{ method: "POST", path: "/api/entries/", handle: () => json({}) }, { method: "GET", path: "/api/entries/:key", handle: () => json({}) }, { method: "GET", path: "/api/entries", handle: () => json([]) }] };
  assert.deepEqual(routeClashes([guestbook, order]), ["POST /api/entries/ is served by both guestbook and order", "GET /api/entries/:key is served by both guestbook and order"]);
  assert.deepEqual(routeClashes([{ ...notes, routes: [...notes.routes, { method: "GET", path: "/api/notes", handle: () => json({}) }] }]), ["GET /api/notes is served twice by notes"]);
  assert.deepEqual(routeClashes([notes, guestbook]), []);
  assert.throws(() => createApp([guestbook, order], new MemoryStore()), /routes clash: POST \/api\/entries\/ is served by both guestbook and order/);
});

test("a route with a fixed path wins over a route with a parameter, whichever feature comes first", async () => {
  const books: Feature = { id: "books", title: "Books", routes: [{ method: "GET", path: "/api/books/:id", handle: (_request, { params }) => json({ book: params["id"] }) }] };
  const top: Feature = { id: "top-books", title: "Top books", routes: [{ method: "GET", path: "/api/books/top", handle: () => json({ top: true }) }] };
  const app = createApp([books, top], new MemoryStore());
  assert.deepEqual(await (await app(new Request("http://app.test/api/books/top"))).json(), { top: true });
  assert.deepEqual(await (await app(new Request("http://app.test/api/books/7"))).json(), { book: "7" });
});

test("the shell names the page for link previews and escapes what it is given", () => {
  const html = shellHtml({ title: "Notes · Jot & Co", description: 'Quick "notes" <for> everyone' });
  assert.match(html, /<title>Notes · Jot &amp; Co<\/title>/);
  assert.match(html, /<meta property="og:title" content="Notes · Jot &amp; Co">/);
  assert.match(html, /<meta name="description" content="Quick &quot;notes&quot; &lt;for&gt; everyone">/);
  assert.match(html, /<meta property="og:description" content="Quick &quot;notes&quot; &lt;for&gt; everyone">/);
  assert.doesNotMatch(shellHtml({ title: "Notes" }), /description/);
});
