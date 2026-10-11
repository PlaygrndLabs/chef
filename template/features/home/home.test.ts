import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../../shared/http.ts";
import { MemoryStore } from "../../shared/storage.ts";
import { feature } from "./index.ts";

test("AC1: GET / answers with the app name", async () => {
  const app = createApp([feature], new MemoryStore());
  const response = await app(new Request("http://app.test/"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, app: "kargah-project" });
});
