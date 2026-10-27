import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { closeBrowser } from "./browser.ts";
import { lookAt, outsideLook } from "./look.ts";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";

function project(pages: string): string {
  const dir = mkdtempSync(join(tmpdir(), "look-"));
  cpSync(join(import.meta.dirname, "..", "shared"), join(dir, "shared"), { recursive: true });
  const path = join(dir, "features", "home", "pages.tsx");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `import type { Page } from "../../shared/app.tsx";\n\n${pages}`);
  return dir;
}

after(closeBrowser);

test("a clean page has nothing to fix", async () => {
  const root = project(`export const pages: readonly Page[] = [{ path: "/home", title: "Home", component: () => <section className="stack"><h1>Welcome</h1><p>Plain words on a plain page.</p><button className="btn">Start</button></section> }];\n`);
  assert.deepEqual(await lookAt([], ["/home"], {}, root), []);
});

test("colors that fade when the scheme changes are read once they settle", async () => {
  const root = project(`const css = ".slow{background:#fff;color:#111;transition:background-color 5s}@media (prefers-color-scheme: dark){.slow{background:#111;color:#fff}}";

export const pages: readonly Page[] = [{ path: "/home", title: "Home", component: () => <><style>{css}</style><p className="slow">Fades with the scheme</p></> }];\n`);
  assert.deepEqual(await lookAt([], ["/home"], {}, root), []);
});

test("catches invisible text, covered text and a page that scrolls sideways", async () => {
  const root = project(`function Home() {
  return (
    <section>
      <h1 style={{ fontSize: 64 }}>Hidden headline</h1>
      <div style={{ height: 200, marginTop: -40, background: "#ffb3d9", position: "relative" }}>Panel</div>
      <a className="btn" style={{ background: "#000", color: "#111" }} href="/x">Find a retailer</a>
      <div style={{ width: 2000 }}>Too wide</div>
    </section>
  );
}

export const pages: readonly Page[] = [{ path: "/home", title: "Home", component: Home }];\n`);
  const found = await lookAt([], ["/home"], {}, root);
  const fails = found.filter((p) => p.severity === "fail").map((p) => p.message);
  assert.ok(fails.some((m) => /"Hidden headline" is covered by div/.test(m)), fails.join("\n"));
  assert.ok(fails.some((m) => /"Find a retailer" has contrast 1\.\d+:1/.test(m)), fails.join("\n"));
  assert.ok(fails.some((m) => /scrolls sideways: div reaches 2\d{3}px/.test(m)), fails.join("\n"));
});

test("a dialog over the page does not count as covering it", async () => {
  const root = project(`export const pages: readonly Page[] = [{ path: "/home", title: "Home", component: () => <><h1>Under the gate</h1><div role="dialog" style={{ position: "fixed", inset: 0, background: "#fff", color: "#111" }}><p>Are you 21 or older?</p></div></> }];\n`);
  assert.deepEqual((await lookAt([], ["/home"], {}, root)).filter((p) => p.severity === "fail"), []);
});

test("a light-only color on a theme that turns dark is caught in dark mode only", async () => {
  const root = project(`export const pages: readonly Page[] = [{ path: "/home", title: "Home", component: () => <div style={{ background: "#fff", padding: 16 }}><p>Fixed white card</p></div> }];\n`);
  const found = await lookAt([], ["/home"], {}, root);
  assert.deepEqual(found.map((p) => [p.view, p.severity]), [["phone dark, desktop dark", "fail"]]);
});

test("a look that commits to light is only looked at in light", async () => {
  const root = project(`export const pages: readonly Page[] = [{ path: "/home", title: "Home", component: () => <div style={{ background: "#fff", padding: 16 }}><p>Fixed white card</p></div> }];\n`);
  writeFileSync(join(root, "features", "home", "look.ts"), `export const look = { scheme: "light" as const };\n`);
  assert.deepEqual(await lookAt([], ["/home"], { scheme: "light" }, root), []);
});

test("a look with a gate looks at the gate and at the page behind it", async () => {
  const root = project(`import { useState } from "react";

function Home() {
  const [entered, setEntered] = useState(() => localStorage.getItem("age") === "ok");
  if (!entered) return <div role="dialog"><p>Are you 21 or older?</p><button className="btn" onClick={() => { localStorage.setItem("age", "ok"); setEntered(true); }}>I'm 21 or older</button></div>;
  return <p style={{ color: "#fafafa", background: "#ffffff" }}>Faint words behind the gate</p>;
}

export const pages: readonly Page[] = [{ path: "/home", title: "Home", component: Home }];\n`);
  assert.deepEqual(await lookAt([], ["/home"], { scheme: "light" }, root), []);
  const found = await lookAt([], ["/home"], { scheme: "light", gate: "21 or older" }, root);
  assert.deepEqual(found.map((p) => [p.view, p.severity, p.message.split(" has ")[0]]), [["phone, desktop", "fail", '"Faint words behind the gate"']]);
});

test("colors, color functions and fonts written outside the look fail, links and look.ts do not", async () => {
  const root = await mkdtemp(join(tmpdir(), "outside-look-"));
  await mkdir(join(root, "features", "shop", "frontend"), { recursive: true });
  await writeFile(join(root, "features", "shop", "pages.tsx"), ['const a = <a href="#faded">Faded</a>;', 'const b = <div style={{ background: "#ffb8fc", color: "var(--fg)" }} />;', 'const c = <p style={{ fontFamily: "Comic Sans MS" }} />;', 'const d = <p style={{ fontFamily: "var(--font-display)" }} />;', 'const e = <svg><path fill="rgb(1 2 3)" /></svg>;', 'const f = <div className="material-hero" style={{ boxShadow: "0 1px 2px color-mix(in srgb, var(--fg) 20%, transparent)" }} />;'].join("\n"));
  await writeFile(join(root, "features", "shop", "look.ts"), 'export const look = { colors: { light: { blush: "#ffb8fc" } } } as const;');
  await writeFile(join(root, "features", "shop", "frontend", "look.ts"), 'export const look = { materials: { hero: "linear-gradient(#000, #fff)" } } as const;');
  await writeFile(join(root, "features", "shop", "frontend", "card.css"), ".card-x{border-color:#abc}");
  await writeFile(join(root, "features", "shop", "pages.test.tsx"), 'const t = "#123456";');
  const found = await outsideLook(root);
  assert.deepEqual(
    found.map((p) => `${p.path} ${p.message.split(" is written")[0]}`),
    ["features/shop/frontend/card.css:1 #abc", "features/shop/pages.tsx:2 #ffb8fc", 'features/shop/pages.tsx:3 font "Comic Sans MS"', "features/shop/pages.tsx:5 rgb(...)"],
  );
  assert.ok(found.every((p) => p.severity === "fail"));
  assert.deepEqual(await outsideLook(root, ["other"]), []);
});
