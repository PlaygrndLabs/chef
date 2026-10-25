import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { renderRegistry } from "./gen.ts";

function project(features: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "app-"));
  for (const folder of ["app", "shared"]) cpSync(join(import.meta.dirname, "..", folder), join(dir, folder), { recursive: true });
  symlinkSync(join(import.meta.dirname, "..", "node_modules"), join(dir, "node_modules"), "dir");
  const files = { ...features, "src/registry.gen.ts": renderRegistry(Object.keys(features)) };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function feature(id: string, method: string, path: string): string {
  return `import { json, type Feature } from "../../shared/http.ts";\n\nexport const feature: Feature = { id: "${id}", title: "${id}", routes: [{ method: "${method}", path: "${path}", handle: () => json({}) }] };\n`;
}

function cli(dir: string, ...args: string[]): { status: number | null; stderr: string } {
  return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(dir, "app", "cli.ts"), ...args], { cwd: dir, encoding: "utf8" });
}

function gen(dir: string): { status: number | null; stderr: string } {
  return cli(dir, "gen", "--check");
}

test("gen --check passes features whose routes are their own", () => {
  const dir = project({ "features/guestbook/index.ts": feature("guestbook", "POST", "/api/notes"), "features/order/index.ts": feature("order", "POST", "/api/orders") });
  const result = gen(dir);
  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
});

test("gen --check fails when a later feature takes a route an earlier one serves", () => {
  const dir = project({ "features/guestbook/index.ts": feature("guestbook", "POST", "/api/entries"), "features/order/index.ts": feature("order", "POST", "/api/entries") });
  const result = gen(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /POST \/api\/entries is served by both guestbook and order/);
});

const pages = `import { createElement } from "react";\n\nconst Body = () => createElement("p", null, "hi");\n\nexport const pages = [{ path: "/notes", title: "Notes", nav: true, component: Body }, { path: "/about", title: "About", description: "Who we are", component: Body }, { path: "/notes/:id", title: "Note", component: Body }, { path: "/feed", title: "Feed", component: Body }];\n`;

test("build writes each fixed page's HTML with its title and description, so link previews name it", () => {
  const dir = project({
    "features/notes/index.ts": feature("notes", "GET", "/feed"),
    "features/notes/pages.tsx": pages,
    "features/notes/look.ts": `export const look = { brand: "Jot", description: "Quick notes" };\n`,
  });
  mkdirSync(join(dir, "dist", "client", "gone"), { recursive: true });
  writeFileSync(join(dir, "dist", "client", "gone", "old.html"), "stale");
  const result = cli(dir, "build");
  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
  const html = (path: string) => readFileSync(join(dir, "dist", "client", path), "utf8");
  assert.match(html("index.html"), /<title>Jot<\/title>.*<meta name="description" content="Quick notes">/);
  assert.match(html("notes.html"), /<title>Notes · Jot<\/title>.*<meta name="description" content="Quick notes">/);
  assert.match(html("about.html"), /<title>About · Jot<\/title>.*<meta name="description" content="Who we are">/);
  assert.match(html("about.html"), /<script type="module" src="\/client\.js"><\/script>/);
  assert.equal(existsSync(join(dir, "dist", "client", "feed.html")), false);
  assert.equal(existsSync(join(dir, "dist", "client", "gone")), false);
  assert.ok(existsSync(join(dir, "dist", "client", "client.js")));
});

test("build still ships the app when a page module cannot load outside the browser", () => {
  const dir = project({
    "features/notes/index.ts": feature("notes", "GET", "/api/notes"),
    "features/notes/pages.tsx": `const saved = window.localStorage.getItem("x");\n\nexport const pages = [{ path: "/notes", title: String(saved), component: () => null }];\n`,
  });
  const result = cli(dir, "build");
  assert.equal(result.status, 0);
  assert.match(result.stderr, /page titles for link previews were skipped/);
  assert.ok(existsSync(join(dir, "dist", "client", "client.js")));
  assert.equal(existsSync(join(dir, "dist", "client", "notes.html")), false);
});
