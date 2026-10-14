import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { serve } from "../../src/serve.ts";
import { REPO_ROOT } from "../../src/world.ts";
import { LIVE_MOCK } from "./live-mock.ts";

const DIST = join(REPO_ROOT, "apps", "dashboard", "dist");

interface MockVoice {
  readonly channel: { emit(event: object): void; readonly url: string };
  readonly sent: unknown[];
  readonly closed: boolean;
  readonly sockets: number;
}

const emit = (page: Page, event: object) => page.evaluate((e) => (window as unknown as { __voice: MockVoice }).__voice.channel.emit(e), event);

describe("live talk in the chat", () => {
  it("starts from the chat, shows the orb and the spoken turns in the chat, mutes and ends", { timeout: 60_000 }, async () => {
    expect(existsSync(join(DIST, "index.html")), "run pnpm build first").toBe(true);
    const local = await serve({ port: 0, real: false, assets: DIST });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(LIVE_MOCK);
      await page.goto(local.url);
      const setup = page.locator('[data-view="setup"]');
      await setup.waitFor({ timeout: 10_000 });
      await setup.getByLabel("Project name").fill("shop");
      await setup.getByRole("button", { name: "Create project" }).click();

      const chat = page.locator("#chat");
      await chat.locator("textarea").fill("a draft");
      expect(await chat.locator("#talk-button").count()).toBe(1);
      expect(await chat.getByRole("button", { name: "Send" }).isEnabled()).toBe(true);
      await chat.locator("textarea").fill("");
      expect(await chat.getByRole("button", { name: "Send" }).isDisabled()).toBe(true);
      await chat.locator("#talk-button").click();
      const panel = page.locator('#live-talk[data-phase="listening"]');
      await panel.waitFor({ timeout: 10_000 });
      expect(await page.evaluate(() => (window as unknown as { __voice: MockVoice }).__voice.channel.url)).toMatch(/\/agents\/project\/shop\?voice=1$/);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __voice: MockVoice }).__voice.sent.length)).toBeGreaterThan(0);
      expect(await chat.locator("textarea").count()).toBe(0);
      expect(await page.locator("#live-talk canvas[data-orb]").count()).toBe(1);
      expect(await page.locator("#talk-button").count()).toBe(0);

      for (const word of ["Add a ", "todo list"]) await emit(page, { type: "session.input_transcript.delta", delta: word });
      await emit(page, { type: "session.output_transcript.delta", delta: "On it." });
      await chat.locator('[data-spoken="you"]').filter({ hasText: "Add a todo list" }).waitFor();
      await chat.locator('[data-spoken="chef"]').filter({ hasText: "On it." }).waitFor();
      expect(await chat.locator('[data-view="welcome"]').count()).toBe(0);

      await page.locator("#live-mute").click();
      await page.locator('#live-talk[data-muted="true"]').waitFor();
      expect(await page.locator("#live-status").innerText()).toContain("Muted");
      await page.locator("#live-mute").click();
      await page.locator('#live-talk[data-muted="false"]').waitFor();

      await page.locator("#live-end").click();
      await page.locator("#live-talk").waitFor({ state: "detached" });
      await chat.locator("textarea").waitFor();
      expect(await page.evaluate(() => (window as unknown as { __voice: MockVoice }).__voice.closed)).toBe(true);
      expect(await chat.locator('[data-spoken="you"]').innerText()).toContain("Add a todo list");

      await chat.locator("#talk-button").click();
      await panel.waitFor({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await page.locator("#live-talk").waitFor({ state: "detached" });
      expect(await page.evaluate(() => (window as unknown as { __voice: MockVoice }).__voice.sockets)).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });
});
