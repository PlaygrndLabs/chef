import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp, json, type Feature } from "./http.ts";
import { MemoryStore } from "./storage.ts";

const home: Feature = { id: "home", title: "Home", routes: [{ method: "GET", path: "/", handle: () => json({ ok: true, app: "chef-project" }) }] };

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
  const app = createApp([home, notes], new MemoryStore());
  const response = await app(new Request("http://app.test/", { headers: { accept: "text/html,application/xhtml+xml" } }));
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  assert.match(html, /<a href="\/notes">Notes<\/a>/);
  assert.doesNotMatch(html, /\/api\/notes|:id/);
});

test("API clients opening / still get the home JSON", async () => {
  const app = createApp([home, notes], new MemoryStore());
  const response = await app(new Request("http://app.test/"));
  assert.deepEqual(await response.json(), { ok: true, app: "chef-project" });
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
