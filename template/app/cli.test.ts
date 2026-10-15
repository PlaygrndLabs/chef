import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { renderRegistry } from "./gen.ts";

function project(features: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "app-"));
  for (const folder of ["app", "shared"]) cpSync(join(import.meta.dirname, "..", folder), join(dir, folder), { recursive: true });
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

function gen(dir: string): { status: number | null; stderr: string } {
  return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(dir, "app", "cli.ts"), "gen", "--check"], { cwd: dir, encoding: "utf8" });
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
