import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { json, type Feature } from "../shared/http.ts";
import { closeBrowser, openPage, STEP_TIMEOUT_MS } from "./browser.ts";

const echoPage = `import { useState } from "react";
import type { Page } from "../../shared/app.tsx";
import { api, Link } from "../../shared/ui.tsx";

function Echo() {
  const [name, setName] = useState("");
  const [said, setSaid] = useState("");
  return (
    <form onSubmit={async (event) => { event.preventDefault(); setSaid((await api<{ hello: string }>("/api/echo", { body: { name } })).hello); }}>
      <label htmlFor="name">Name</label>
      <input id="name" value={name} onChange={(event) => setName(event.target.value)} />
      <button>Save</button>
      <p role="status">{said}</p>
      <Link to="/about">About</Link>
      <a href="/about?from=plain">Plain link</a>
    </form>
  );
}

function About() {
  return <h1>About</h1>;
}

export const pages: readonly Page[] = [{ path: "/echo", title: "Echo", nav: true, component: Echo }, { path: "/about", title: "About", description: "Who we are", component: About }];
`;

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "client-"));
  cpSync(join(import.meta.dirname, "..", "shared"), join(dir, "shared"), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const echo: Feature = { id: "echo", title: "Echo", routes: [{ method: "POST", path: "/api/echo", handle: async (request) => json({ hello: ((await request.json()) as { name: string }).name }) }] };

const root = project({ "features/echo/pages.tsx": echoPage });

after(closeBrowser);

test("drives a React page in a real browser against the app", async () => {
  const { page: tab, close } = await openPage([echo], "/echo", undefined, undefined, root);
  await tab.getByLabel("Name").fill("Ada");
  await tab.getByRole("button", { name: "Save" }).click();
  await tab.getByRole("status").filter({ hasText: "Ada" }).waitFor();
  assert.equal(await tab.getByRole("status").textContent(), "Ada");
  assert.equal(await tab.title(), "Echo");
  await close();
});

test("links move between pages inside the app without loading it again", async () => {
  const { page: tab, close } = await openPage([echo], "/echo", undefined, undefined, root);
  await tab.evaluate(() => Object.assign(window, { stayed: true }));
  await tab.getByRole("link", { name: "About" }).first().click();
  await tab.getByRole("heading", { name: "About" }).waitFor();
  await tab.goBack();
  await tab.getByLabel("Name").waitFor();
  await tab.getByRole("link", { name: "Plain link" }).click();
  await tab.getByRole("heading", { name: "About" }).waitFor();
  assert.equal(new URL(tab.url()).search, "?from=plain");
  assert.equal(await tab.evaluate(() => (window as unknown as { stayed?: boolean }).stayed), true);
  await close();
});

test("home opens the app's first page, and a page nobody built says so", async () => {
  const { page: tab, close } = await openPage([echo], "/", undefined, undefined, root);
  await tab.getByLabel("Name").waitFor();
  assert.equal(new URL(tab.url()).pathname, "/echo");
  await tab.goto("/missing");
  await tab.getByText("This page isn't built yet").waitFor();
  await close();
});

test("an app with no pages yet says so on its home page", async () => {
  const { page: tab, close } = await openPage([], "/", undefined, undefined, project({}));
  await tab.getByText("Nothing here yet").waitFor();
  await close();
});

test("a step on a page that is not built yet fails within the step timeout", async () => {
  const { page: tab, close } = await openPage([], "/missing", undefined, undefined, root);
  const started = Date.now();
  await assert.rejects(tab.getByRole("button", { name: "Save" }).click());
  assert.ok(Date.now() - started < STEP_TIMEOUT_MS * 2);
  await close();
});

test("each page tells a Chef frame around the app which page is open and which pages exist", async () => {
  const { page: tab, close } = await openPage([echo], "/echo", undefined, undefined, root);
  const reports = await tab.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const seen: unknown[] = [];
        addEventListener("message", (event) => {
          seen.push(event.data);
          if (seen.length === 2) resolve(seen);
        });
        const frame = document.createElement("iframe");
        frame.src = "/echo";
        frame.onload = () => {
          const timer = setInterval(() => {
            const link = frame.contentDocument?.querySelector("a[href='/about']") as HTMLAnchorElement | null;
            if (!link) return;
            clearInterval(timer);
            link.click();
          }, 50);
        };
        document.body.appendChild(frame);
      }),
  );
  const pages = [{ title: "Echo", path: "/echo" }, { title: "About", path: "/about" }];
  assert.deepEqual(reports, [{ chef: "page", path: "/echo", title: "Echo", pages }, { chef: "page", path: "/about", title: "About", pages }]);
  await close();
});

test("moving to another page names it in the tab title and description", async () => {
  const { page: tab, close } = await openPage([echo], "/echo", undefined, undefined, root);
  const description = () => tab.evaluate(() => document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null);
  assert.equal(await tab.title(), "Echo");
  assert.equal(await description(), null);
  await tab.getByRole("link", { name: "About", exact: true }).click();
  await tab.getByRole("heading", { name: "About" }).waitFor();
  assert.equal(await tab.title(), "About");
  assert.equal(await description(), "Who we are");
  await tab.goBack();
  await tab.getByRole("button", { name: "Save" }).waitFor();
  assert.equal(await description(), null);
  await close();
});

test("pages render in the fonts the look picks", async () => {
  const styled = project({
    "features/notes/pages.tsx": `import type { Page } from "../../shared/app.tsx";\n\nexport const pages: readonly Page[] = [{ path: "/notes", title: "Notes", component: () => <h1>Notes</h1> }];\n`,
    "features/notes/look.ts": `export const look = { fonts: { display: "Anton", body: "Inter" } };\n`,
  });
  const { page: tab, close } = await openPage([], "/notes", undefined, undefined, styled);
  await tab.evaluate(() => document.fonts.ready);
  assert.equal(await tab.evaluate(() => document.fonts.check('32px "Anton"')), true);
  assert.match(await tab.getByRole("heading", { name: "Notes" }).evaluate((el) => getComputedStyle(el).fontFamily), /^"?Anton"?,/);
  await close();
});
