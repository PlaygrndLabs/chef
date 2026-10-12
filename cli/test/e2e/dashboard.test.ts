import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { serve, TODO_PROMPT } from "../../src/serve.ts";
import { REPO_ROOT } from "../../src/world.ts";

const DIST = join(REPO_ROOT, "apps", "dashboard", "dist");

describe("dashboard in a browser", () => {
  it("sends a chat message through CopilotKit and shows the session until it merges", async () => {
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
      await page.locator('#live-sessions [data-state="merged"]').waitFor({ timeout: 60_000 });
      const chat = () => page.locator("#chat").innerText();
      await expect.poll(chat, { timeout: 10_000 }).toMatch(/s1 merged as [0-9a-f]{12}/);
      expect(await chat()).toContain("Routed as new feature for todo-add");
      const card = await page.locator("#live-sessions").innerText();
      expect(card).toContain("review approved");
      expect(card).toContain("gate passed");
      await expect.poll(() => page.locator("#features").innerText(), { timeout: 10_000 }).toContain("merged");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });
});
