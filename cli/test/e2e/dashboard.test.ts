import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { serve, TODO_PROMPT } from "../../src/serve.ts";
import { REPO_ROOT } from "../../src/world.ts";

const DIST = join(REPO_ROOT, "apps", "dashboard", "dist");

describe("dashboard in a browser", () => {
  it("starts with no projects, creates one, sends a chat message through CopilotKit, follows the feature until it goes live and opens it", async () => {
    expect(existsSync(join(DIST, "index.html")), "run pnpm build first").toBe(true);
    const local = await serve({ port: 0, real: false, assets: DIST });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(local.url);
      const setup = page.locator('[data-view="setup"]');
      await setup.waitFor({ timeout: 10_000 });
      expect(await setup.innerText()).toContain("Create your first project");
      await setup.getByLabel("Project name").fill("shop");
      await setup.getByRole("button", { name: "Create project" }).click();
      await page.getByRole("button", { name: "Switch project" }).click();
      await page.getByRole("menuitem", { name: "shop" }).waitFor();
      await page.getByRole("menuitem", { name: "New project" }).waitFor();
      await page.keyboard.press("Escape");
      expect(new URL(page.url()).searchParams.get("project")).toBe("shop");
      const input = page.locator("#chat textarea");
      await input.fill(TODO_PROMPT);
      await input.press("Enter");
      const card = page.locator('#chat [data-session="s1"][data-state="merged"]');
      await card.waitFor({ timeout: 60_000 });
      expect(await card.innerText()).toContain("Live");
      expect(await page.locator("#chat").innerText()).toContain("On it. This is a new feature.");
      await expect.poll(() => page.locator('#features [data-group="live"] [data-session="s1"]').getAttribute("data-state"), { timeout: 10_000 }).toBe("merged");
      expect(await page.locator('#project-bar [data-chip="working"]').innerText()).toContain("Nothing running");
      await page.getByRole("tab", { name: "By feature" }).click();
      await page.locator('#features [data-feature="todo-add"][data-status="merged"]').waitFor();
      await page.getByRole("tab", { name: "By status" }).click();
      await card.click();
      const feature = page.locator('[data-view="feature"][data-state="merged"]');
      await feature.waitFor({ timeout: 10_000 });
      await feature.locator('[data-review="approved"]').waitFor();
      await feature.locator('[data-gate="passed"]').waitFor();
      expect(await feature.innerText()).toContain("Went live");
      expect(new URL(page.url()).searchParams.get("session")).toBe("s1");
      expect(await feature.locator('[data-artifact="checks"]').innerText()).toContain("passed");
      await feature.locator('[data-artifact="checks"]').click();
      await page.getByRole("tabpanel", { name: "Checks" }).locator('[data-check][data-ok="true"]').first().waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("menuitem", { name: "Show changes and details" }).click();
      await expect.poll(() => page.getByRole("tabpanel", { name: "Changes" }).innerText(), { timeout: 10_000 }).toContain("features/todo-add/index.ts");
      expect(await page.getByRole("separator", { name: "Resize the preview" }).count()).toBe(1);
      await page.getByRole("button", { name: "Open large" }).click();
      await page.getByRole("dialog").getByRole("tabpanel", { name: "Changes" }).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "Make smaller" }).click();
      await page.getByRole("separator", { name: "Resize the preview" }).waitFor({ timeout: 10_000 });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });

  it("asks for a model and a Cloudflare account when none is set and saves them", async () => {
    const local = await serve({ port: 0, real: false, assets: DIST, settings: { TYPESAFE_API_KEY: "ts-deployment-key" } });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(local.url);
      const dialog = page.locator('[data-dialog="settings"]');
      await dialog.waitFor({ timeout: 10_000 });
      const claude = dialog.locator("#settings-llm");
      expect(await claude.locator('[data-current="llm"]').getAttribute("data-set")).toBe("no");
      await claude.getByRole("radio", { name: "Custom provider" }).click();
      await claude.getByLabel("Base URL").fill("https://llm.example/");
      await claude.getByLabel("API key").fill("sk-test-12345678");
      await claude.getByRole("button", { name: "Save" }).click();
      await expect.poll(() => claude.locator('[data-current="llm"]').innerText(), { timeout: 10_000 }).toContain("https://llm.example, key …5678");
      await dialog.getByRole("tab", { name: /Previews/ }).click();
      const cloudflare = dialog.locator("#settings-cloudflare");
      await cloudflare.getByLabel("Account id").fill("0123456789abcdef0123456789abcdef");
      await cloudflare.getByLabel("API token").fill("cf-token-abcd1234");
      await cloudflare.getByRole("button", { name: "Save" }).click();
      await expect.poll(() => cloudflare.locator('[data-current="cloudflare"]').getAttribute("data-set"), { timeout: 10_000 }).toBe("yes");
      await dialog.getByRole("tab", { name: "Routing" }).click();
      expect(await dialog.locator('[data-current="jev"]').innerText()).toContain("from the deployment");
      const settings = (await (await page.request.get(`${local.url}/api/settings`)).json()) as Record<string, unknown>;
      expect(settings["llm"]).toEqual({ kind: "custom", baseUrl: "https://llm.example", keyHint: "…5678", source: "app" });
      expect(settings["cloudflare"]).toEqual({ accountId: "0123456789abcdef0123456789abcdef", keyHint: "…1234", source: "app" });
      expect(JSON.stringify(settings)).not.toContain("sk-test-12345678");
    } finally {
      await browser.close();
      await local.close();
    }
  });
});
