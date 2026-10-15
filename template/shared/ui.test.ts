import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, openPage } from "../app/browser.ts";
import { json, type Feature } from "./http.ts";
import { html, icon, page, raw, renderPage } from "./ui.ts";

after(closeBrowser);

test("html escapes values and keeps nested markup", () => {
  const name = "<script>alert(1)</script>";
  const out = html`<ul>${["a", "b"].map((x) => html`<li>${x}</li>`)}</ul><p title="${name}">${name}</p>${raw("<hr>")}${null}${false}`;
  assert.equal(out.value, '<ul><li>a</li><li>b</li></ul><p title="&#60;script&#62;alert(1)&#60;/script&#62;">&#60;script&#62;alert(1)&#60;/script&#62;</p><hr>');
});

test("icons are hidden from screen readers unless labelled", () => {
  assert.match(icon("trash").value, /aria-hidden="true"/);
  assert.match(icon("trash", { label: "Delete" }).value, /role="img" aria-label="Delete"/);
});

test("page returns a styled html document", async () => {
  const response = page({ title: "Todos", body: html`<h1>Todos</h1>`, accent: "#e11d48" });
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const text = await response.text();
  assert.match(text, /<title>Todos<\/title>/);
  assert.match(text, /--accent:#e11d48/);
  assert.match(text, /<main class="container"><h1>Todos<\/h1><\/main>/);
});

test("an accent that is not a color is ignored", () => {
  assert.doesNotMatch(renderPage({ title: "x", body: "", accent: "red}body{display:none" }).value, /body\{display:none/);
});

test("a page script can use the browser helpers", async () => {
  const demo: Feature = {
    id: "demo",
    title: "Demo",
    routes: [{ method: "GET", path: "/demo", handle: () => page({ title: "Demo", body: html`<button class="btn" id="go">Go</button><p id="out"></p>`, script: `document.getElementById("go").addEventListener("click", () => { document.getElementById("out").innerHTML = ui.icon("check") + ui.escape("<b>"); ui.toast("Saved"); });` }) }],
  };
  const { page: tab, close } = await openPage([demo], "/demo");
  await tab.getByRole("button", { name: "Go" }).click();
  await tab.getByText("Saved").waitFor();
  assert.match((await tab.locator("#out").innerHTML()) ?? "", /<svg[^>]*class="icon".*&lt;b&gt;/);
  const background = await tab.evaluate(() => getComputedStyle(document.querySelector(".btn") as Element).backgroundColor);
  assert.notEqual(background, "rgba(0, 0, 0, 0)");
  await close();
});

test("a failed request always shows a message, even when the server says nothing", async () => {
  const form = html`<form id="sign"><button class="btn">Sign</button></form><div class="alert alert-danger" role="alert" id="problem" hidden></div><p class="error" id="field"></p>`;
  const client = `document.getElementById("sign").addEventListener("submit", async (event) => {
  event.preventDefault();
  for (const path of ["/api/empty", "/api/said", "/api/broken"]) {
    try { await ui.api(path, { body: { name: "Nino" } }); } catch (error) { ui.error(document.body.appendChild(Object.assign(document.createElement("p"), { className: "error" })), error); }
  }
  ui.error("#problem", new Error(""));
});`;
  const guestbook: Feature = {
    id: "guestbook",
    title: "Guestbook",
    routes: [
      { method: "GET", path: "/guestbook", handle: () => page({ title: "Guestbook", body: form, script: client }) },
      { method: "POST", path: "/api/empty", handle: () => new Response(null, { status: 500 }) },
      { method: "POST", path: "/api/said", handle: () => json({ error: "Name is taken" }, 409) },
      {
        method: "POST",
        path: "/api/broken",
        handle: () => {
          throw new Error("storage is down");
        },
      },
    ],
  };
  const { page: tab, close } = await openPage([guestbook], "/guestbook");
  assert.equal(await tab.locator("#problem").isVisible(), false);
  assert.equal(await tab.locator("#field").isVisible(), false);
  await tab.getByRole("button", { name: "Sign" }).click();
  await tab.getByRole("alert").filter({ hasText: "Something went wrong" }).waitFor();
  assert.deepEqual(await tab.locator("body > p.error").allTextContents(), ["The request failed (500 Internal Server Error). Try again.", "Name is taken", "The server failed while answering POST /api/broken: storage is down"]);
  await close();
});
