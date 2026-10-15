import assert from "node:assert/strict";
import { test } from "node:test";
import { testApp } from "../../app/testing.ts";
import { feature } from "./index.ts";

const post = (text: unknown): RequestInit => ({ method: "POST", body: JSON.stringify({ text }), headers: { "content-type": "application/json" } });

test("AC1: POST /todos adds an item and returns it", async (t) => {
  const app = testApp(t, [feature]);
  const response = await app.fetch("/todos", post("buy milk"));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "000001", text: "buy milk", done: false });
});

test("AC2: GET /todos lists added items in order", async (t) => {
  const app = testApp(t, [feature]);
  await app.fetch("/todos", post("buy milk"));
  await app.fetch("/todos", post("call mom"));
  const response = await app.fetch("/todos");
  const items = (await response.json()) as { text: string }[];
  assert.deepEqual(items.map((i) => i.text), ["buy milk", "call mom"]);
});

test("AC3: an empty item is rejected", async (t) => {
  const app = testApp(t, [feature]);
  const response = await app.fetch("/todos", post("   "));
  assert.equal(response.status, 400);
});
