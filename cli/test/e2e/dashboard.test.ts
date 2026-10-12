import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { serve, TODO_PROMPT } from "../../src/serve.ts";
import { REPO_ROOT } from "../../src/world.ts";

const DIST = join(REPO_ROOT, "apps", "dashboard", "dist");

describe("dashboard in a browser", () => {
  it("sends a chat message through CopilotKit, follows the feature until it goes live and opens it", async () => {
    expect(existsSync(join(DIST, "index.html")), "run pnpm build first").toBe(true);
    const local = await serve({ port: 0, project: "demo", real: false, assets: DIST });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${local.url}/?project=demo`);
      const input = page.locator("#chat textarea");
      await input.fill(TODO_PROMPT);
      await input.press("Enter");
      const card = page.locator('#chat [data-session="s1"][data-state="merged"]');
      await card.waitFor({ timeout: 60_000 });
      expect(await card.innerText()).toContain("Live");
      expect(await page.locator("#chat").innerText()).toContain("On it. This is a new feature.");
      await expect.poll(() => page.locator('#features [data-feature="todo-add"]').getAttribute("data-status"), { timeout: 10_000 }).toBe("merged");
      await card.click();
      const feature = page.locator('[data-view="feature"][data-state="merged"]');
      await feature.waitFor({ timeout: 10_000 });
      await feature.locator('[data-review="approved"]').waitFor();
      await feature.locator('[data-gate="passed"]').waitFor();
      expect(await feature.innerText()).toContain("Went live");
      expect(new URL(page.url()).searchParams.get("session")).toBe("s1");
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("menuitem", { name: "Show changes and details" }).click();
      await expect.poll(() => page.getByRole("tabpanel", { name: "Changes" }).innerText(), { timeout: 10_000 }).toContain("features/todo-add/index.ts");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });

  it("asks for a model provider when none is set and saves an API key", async () => {
    const local = await serve({ port: 0, project: "demo", real: false, assets: DIST, providers: {} });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${local.url}/?project=demo`);
      const dialog = page.locator('[data-dialog="providers"]');
      await dialog.waitFor({ timeout: 10_000 });
      const claude = dialog.locator("#provider-llm");
      expect(await claude.locator("[data-current]").getAttribute("data-current")).toBe("none");
      await claude.getByRole("radio", { name: "Custom provider" }).click();
      await claude.getByLabel("Base URL").fill("https://llm.example/");
      await claude.getByLabel("API key").fill("sk-test-12345678");
      await claude.getByRole("button", { name: "Save" }).click();
      await expect.poll(() => claude.locator("[data-current]").getAttribute("data-current"), { timeout: 10_000 }).toBe("custom");
      expect(await claude.locator("[data-current]").innerText()).toContain("https://llm.example, key …5678");
      const response = await page.request.get(`${local.url}/api/settings`);
      expect(await response.json()).toEqual({ llm: { kind: "custom", baseUrl: "https://llm.example", keyHint: "…5678", source: "app" }, voice: null });
    } finally {
      await browser.close();
      await local.close();
    }
  });
});
