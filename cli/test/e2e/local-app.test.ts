import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { createNodeFetchHandler } from "@copilotkit/runtime/v2/node";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { memoryStore, startApp } from "../../src/app.ts";
import { serve, TODO_PROMPT } from "../../src/serve.ts";
import { REPO_ROOT } from "../../src/world.ts";

const DIST = join(REPO_ROOT, "apps", "dashboard", "dist");
const PASSWORD = "local app password";

async function guardedEngine(target: string) {
  let unauthorized = 0;
  const handler = createNodeFetchHandler(async (request: Request) => {
    if (request.headers.get("authorization") !== `Bearer ${PASSWORD}`) {
      unauthorized++;
      return Response.json({ error: "sign in first" }, { status: 401 });
    }
    const url = new URL(request.url);
    const body = request.method === "GET" || request.method === "HEAD" ? null : request.body;
    const headers = new Headers(request.headers);
    for (const name of ["host", "connection", "transfer-encoding", "content-length", "upgrade"]) headers.delete(name);
    return fetch(`${target}${url.pathname}${url.search}`, { method: request.method, headers, ...(body ? { body, duplex: "half" } : {}) } as RequestInit);
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    unauthorized: () => unauthorized,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe("local app in a browser", () => {
  it("connects to a chef in the cloud, then creates a project and builds a feature through it", async () => {
    expect(existsSync(join(DIST, "index.html")), "run pnpm build first").toBe(true);
    const cloud = await serve({ port: 0, real: false, assets: DIST, settings: { ANTHROPIC_API_KEY: "sk-test", CF_ACCOUNT_ID: "account", CF_API_TOKEN: "token" } });
    const engine = await guardedEngine(cloud.url);
    const store = memoryStore();
    const app = await startApp({ port: 0, store, assets: DIST });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(app.url);
      const place = page.locator('[data-view="place"]');
      await place.waitFor({ timeout: 10_000 });
      expect(await place.locator('[data-place="cloud"]').innerText()).toContain("Recommended");
      await place.locator('[data-place="cloud"]').getByRole("tab", { name: "Set it up" }).click();
      expect(await place.locator('[data-view="cloudflare-setup"]').innerText()).toContain("Check my account");
      await place.locator('[data-place="cloud"]').getByRole("tab", { name: "I have chef there" }).click();
      expect(await place.locator('[data-place="computer"]').getByRole("button", { name: "Use this computer" }).isDisabled()).toBe(true);
      const connect = page.locator('[data-view="connect"]');
      await connect.waitFor({ timeout: 10_000 });
      await connect.getByLabel("Address of your chef").fill(engine.url);
      await connect.getByLabel("Password").fill("not the password");
      await connect.getByRole("button", { name: "Connect" }).click();
      await connect.getByRole("alert").waitFor();
      expect(await connect.getByRole("alert").innerText()).toContain("wrong password");
      await connect.getByLabel("Password").fill(PASSWORD);
      await connect.getByRole("button", { name: "Connect" }).click();
      const setup = page.locator('[data-view="setup"]');
      await setup.waitFor({ timeout: 10_000 });
      expect(store.read()).toEqual({ place: "cloud", url: engine.url, password: PASSWORD });
      await setup.getByRole("button", { name: "Settings" }).click();
      const settings = page.locator('[data-dialog="settings"]');
      await settings.waitFor({ timeout: 10_000 });
      await settings.getByRole("tab", { name: "Password" }).click();
      expect(await settings.locator('[data-current="engine"]').innerText()).toBe(`Connected to ${engine.url}`);
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "hidden" });
      await setup.getByLabel("Project name").fill("shop");
      const ready = page.waitForResponse((r) => r.url().endsWith("/api/projects/shop/copilotkit/info") && r.ok());
      await setup.getByRole("button", { name: "Create project" }).click();
      await ready;
      const input = page.locator("#chat textarea");
      await input.fill(TODO_PROMPT);
      await input.press("Enter");
      const card = page.locator('#chat [data-session="s1"][data-state="merged"]');
      await card.waitFor({ timeout: 60_000 });
      expect(await card.innerText()).toContain("Live");
      expect(engine.unauthorized()).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await app.close();
      await engine.close();
      await cloud.close();
    }
  });
});
