import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FONTS, type FontName } from "../shared/fonts.ts";
import { chosenFonts, fontAssets } from "./fonts.ts";

const modules = join(import.meta.dirname, "..", "node_modules");

test("every font in the catalog ships its sheets and files", async () => {
  for (const name of Object.keys(FONTS) as FontName[]) {
    const assets = await fontAssets({ display: name }, modules);
    assert.match(assets.css, /@font-face/, name);
    assert.ok(assets.files.size > 0, name);
    for (const file of assets.files.values()) assert.ok(existsSync(file), file);
  }
});

test("names outside the catalog are left out", () => {
  assert.deepEqual(chosenFonts({ display: "Comic Sans", body: "Geist", mono: 3 }), { body: "Geist" });
});

test("no fonts picked gives no sheet", async () => {
  const assets = await fontAssets(undefined, modules);
  assert.equal(assets.css, "");
  assert.equal(assets.files.size, 0);
});
