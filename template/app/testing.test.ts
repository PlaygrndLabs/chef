import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { json, type Feature } from "../shared/http.ts";
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
    { method: "GET", path: "/api/votes", handle: async (_request, { store }) => json({ votes: (await store.get<number>("votes")) ?? 0 }) },
  ],
};

const votesPage = `import type { Page } from "../../shared/app.tsx";
import { api, useLoad } from "../../shared/ui.tsx";

function Votes() {
  const { data } = useLoad(() => api<{ votes: number }>("/api/votes"));
  return <p role="status">{data ? \`\${data.votes} votes\` : "Loading"}</p>;
}

export const pages: readonly Page[] = [{ path: "/votes", title: "Votes", component: Votes }];
`;

const root = mkdtempSync(join(tmpdir(), "votes-"));
cpSync(join(import.meta.dirname, "..", "shared"), join(root, "shared"), { recursive: true });
mkdirSync(join(root, "features", "votes"), { recursive: true });
writeFileSync(join(root, "features", "votes", "pages.tsx"), votesPage);

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
  const app = testApp(t, [votes], {}, root);
  await app.fetch("/api/votes", { method: "POST" });
  await app.fetch("/api/votes", { method: "POST" });
  const { page: tab } = await app.open("/votes");
  await tab.getByRole("status").filter({ hasText: "2 votes" }).waitFor();
});
