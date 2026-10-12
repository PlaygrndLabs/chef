import assert from "node:assert/strict";
import { after, test } from "node:test";
import { json, type Feature } from "../shared/http.ts";
import { closeBrowser, openPage } from "./browser.ts";

const page = `<!doctype html><html><body><label for="name">Name</label><input id="name"><button>Save</button><p role="status"></p>
<script>
document.querySelector("button").addEventListener("click", async () => {
  const response = await fetch("/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: document.querySelector("input").value }) });
  document.querySelector("p").textContent = (await response.json()).hello;
});
</script></body></html>`;

const echo: Feature = {
  id: "echo",
  title: "Echo",
  routes: [
    { method: "GET", path: "/echo", handle: () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }) },
    { method: "POST", path: "/api/echo", handle: async (request) => json({ hello: ((await request.json()) as { name: string }).name }) },
  ],
};

after(closeBrowser);

test("drives a feature page in a real browser against the app", async () => {
  const { page: tab, close } = await openPage([echo], "/echo");
  await tab.getByLabel("Name").fill("Ada");
  await tab.getByRole("button", { name: "Save" }).click();
  await tab.getByRole("status").filter({ hasText: "Ada" }).waitFor();
  assert.equal(await tab.getByRole("status").textContent(), "Ada");
  await close();
});
