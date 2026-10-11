import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../../shared/http.ts";
import { MemoryStore } from "../../shared/storage.ts";
import { feature } from "./index.ts";

const post = (text: unknown) => new Request("http://app.test/todos", { method: "POST", body: JSON.stringify({ text }), headers: { "content-type": "application/json" } });

test("AC1: POST /todos adds an item and returns it", async () => {
  const app = createApp([feature], new MemoryStore());
  const response = await app(post("buy milk"));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "000001", text: "buy milk", done: false });
});

test("AC2: GET /todos lists added items in order", async () => {
  const app = createApp([feature], new MemoryStore());
  await app(post("buy milk"));
  await app(post("call mom"));
  const response = await app(new Request("http://app.test/todos"));
  const items = (await response.json()) as { text: string }[];
  assert.deepEqual(items.map((i) => i.text), ["buy milk", "call mom"]);
});

test("AC3: an empty item is rejected", async () => {
  const app = createApp([feature], new MemoryStore());
  const response = await app(post("   "));
  assert.equal(response.status, 400);
});
