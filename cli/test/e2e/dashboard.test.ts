import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { serve, TODO_PROMPT } from "../../src/serve.ts";
import { REPO_ROOT } from "../../src/world.ts";

const DIST = join(REPO_ROOT, "apps", "dashboard", "dist");

describe("dashboard in a browser", () => {
  it("sends a chat message through CopilotKit, follows the session until it merges and opens it", async () => {
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
      const card = page.locator('#live-sessions [data-state="merged"]');
      await card.waitFor({ timeout: 60_000 });
      expect(await card.innerText()).toMatch(/Merged as [0-9a-f]{7}/);
      await expect.poll(() => page.locator('#features [data-feature="todo-add"]').getAttribute("data-status"), { timeout: 10_000 }).toBe("merged");
      await card.click();
      const session = page.locator('[data-view="session"][data-state="merged"]');
      await session.waitFor({ timeout: 10_000 });
      await session.locator('[data-review="approved"]').waitFor();
      await session.locator('[data-gate="passed"]').waitFor();
      expect(new URL(page.url()).searchParams.get("session")).toBe("s1");
      await page.getByRole("tab", { name: "Changes" }).click();
      await expect.poll(() => page.getByRole("tabpanel", { name: "Changes" }).innerText(), { timeout: 10_000 }).toContain("features/todo-add/index.ts");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });
});
