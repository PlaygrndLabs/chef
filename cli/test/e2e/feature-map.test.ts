import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { serve, TODO_PROMPT } from "../../src/serve.ts";
import { REPO_ROOT } from "../../src/world.ts";

const DIST = join(REPO_ROOT, "apps", "dashboard", "dist");
const SHOTS = process.env["CHEF_SHOTS"];

describe("feature list as a feature map in a browser", () => {
  it("maps the current features from the chat, adds a wish under one and shows how to reach it", async () => {
    expect(existsSync(join(DIST, "index.html")), "run pnpm build first").toBe(true);
    const local = await serve({ port: 0, real: false, assets: DIST });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(local.url);
      const setup = page.locator('[data-view="setup"]');
      await setup.waitFor({ timeout: 10_000 });
      await setup.getByLabel("Project name").fill("shop");
      await setup.getByRole("button", { name: "Create project" }).click();
      const input = page.locator("#chat textarea");
      await input.waitFor();
      await input.fill(TODO_PROMPT);
      await input.press("Enter");
      await page.locator('#features [data-feature="todo-add"][data-status="merged"]').waitFor({ timeout: 60_000 });
      await input.fill("/map");
      await input.press("Enter");
      await page.locator("#chat", { hasText: "already has every feature" }).waitFor({ timeout: 30_000 });
      await page.locator('#features [data-feature="todo-add"][data-mark="current"]').waitFor({ timeout: 10_000 });

      await page.locator('#features [data-feature="todo-add"]').hover();
      await page.getByRole("button", { name: /More for/ }).first().click();
      await page.getByRole("menuitem", { name: "Add a wish under it" }).click();
      const dialog = page.locator('[data-dialog="add-wish"]');
      await dialog.getByLabel("Title").fill("Share the list");
      await dialog.getByRole("button", { name: "Add" }).click();
      const wish = page.locator('#features li:has([data-feature="todo-add"]) [data-feature="share-the-list"][data-mark="wish"]');
      await wish.waitFor({ timeout: 10_000 });
      await wish.click();
      const view = page.locator('[data-view="feature"][data-feature="share-the-list"]');
      await view.waitFor({ timeout: 10_000 });
      expect(await view.locator('[data-section="path"]').innerText()).toContain("start the app");
      await view.getByRole("button", { name: "Edit the steps" }).click();
      await view.getByLabel("Steps from the feature above").fill("Press Share on the list.");
      await view.getByRole("button", { name: "Save" }).click();
      await view.locator('[data-section="path"]', { hasText: "Press Share on the list." }).waitFor({ timeout: 10_000 });
      await view.getByRole("button", { name: "Build it" }).waitFor();
      if (SHOTS) {
        await page.screenshot({ path: join(SHOTS, "feature-map-light.png") });
        await page.emulateMedia({ colorScheme: "dark" });
        await page.screenshot({ path: join(SHOTS, "feature-map-dark.png") });
        await page.emulateMedia({ colorScheme: "light" });
      }
      await view.getByRole("button", { name: "Build it" }).click();
      await page.locator('#features [data-feature="share-the-list"][data-mark="working"]').waitFor({ timeout: 20_000 });
      if (SHOTS) await page.screenshot({ path: join(SHOTS, "feature-map-working.png") });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  }, 180_000);
});
