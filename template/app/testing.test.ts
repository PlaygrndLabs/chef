import assert from "node:assert/strict";
import { after, test } from "node:test";
import { json, type Feature } from "../shared/http.ts";
import { html, page } from "../shared/ui.ts";
import { closeBrowser } from "./browser.ts";
import { testApp } from "./testing.ts";

const votes: Feature = {
  id: "votes",
  title: "Votes",
  routes: [
    {
      method: "POST",
      path: "/api/votes",
      handle: async (_request, { store }) => {
        const votes = ((await store.get<number>("votes")) ?? 0) + 1;
        await store.put("votes", votes);
        return json({ votes }, 201);
      },
    },
    { method: "GET", path: "/votes", handle: async (_request, { store }) => page({ title: "Votes", body: html`<p role="status">${(await store.get<number>("votes")) ?? 0} votes</p>` }) },
  ],
};

after(closeBrowser);

test("a test that votes changes only its own store", async (t) => {
  const app = testApp(t, [votes]);
  assert.equal((await app.fetch("/api/votes", { method: "POST" })).status, 201);
  assert.equal(await app.store.get("votes"), 1);
});

test("the next test starts from an empty store", async (t) => {
  const app = testApp(t, [votes]);
  assert.equal(await app.store.get("votes"), null);
  assert.deepEqual(await (await app.fetch("/api/votes", { method: "POST" })).json(), { votes: 1 });
});

test("a page opened in a test sees the data of that test and closes when the test ends", async (t) => {
  const app = testApp(t, [votes]);
  await app.fetch("/api/votes", { method: "POST" });
  await app.fetch("/api/votes", { method: "POST" });
  const { page: tab } = await app.open("/votes");
  assert.equal(await tab.getByRole("status").textContent(), "2 votes");
});
