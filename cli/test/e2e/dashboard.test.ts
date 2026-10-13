import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { serve, TODO_PROMPT, TODO_CLOUD_PROMPT } from "../../src/serve.ts";
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
      await page.keyboard.press("Escape");
      await page.locator("#new-project-button").waitFor();
      await page.locator("#project-settings-button").waitFor();
      await page.locator("#talk-button").waitFor();
      await page.locator("#app-menu").click();
      await page.getByRole("menuitemcheckbox", { name: "Talk button" }).click();
      await page.locator("#talk-button").waitFor({ state: "detached" });
      await page.getByRole("menu").waitFor({ state: "detached" });
      await page.locator("#app-menu").click();
      await page.getByRole("menuitemcheckbox", { name: "Talk button" }).click();
      await page.locator("#talk-button").waitFor();
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
      expect(await dialog.getAttribute("data-section")).toBe("models");
      expect(await dialog.locator('[data-settings-nav="previews"] [aria-label="needs setup"]').count()).toBe(1);
      await dialog.locator('[data-settings-nav="previews"]').click();
      const cloudflare = dialog.locator("#settings-cloudflare");
      await cloudflare.getByLabel("Account id").fill("0123456789abcdef0123456789abcdef");
      await cloudflare.getByLabel("API token").fill("cf-token-abcd1234");
      await cloudflare.getByRole("button", { name: "Save" }).click();
      await expect.poll(() => cloudflare.locator('[data-current="cloudflare"]').getAttribute("data-set"), { timeout: 10_000 }).toBe("yes");
      await dialog.locator('[data-settings-nav="router"]').click();
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

  it("edits agents for every project and for one project, with history, and shows who works on a build", async () => {
    const local = await serve({ port: 0, real: false, assets: DIST, project: "shop" });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const agents = async () => (await (await page.request.get(`${local.url}/api/agents`)).json()) as { version: number; roles: { role: string; instructions: string; skills: string[]; custom: boolean; edited: boolean }[]; router: { useJev: boolean }; skills: { name: string; everyone: boolean }[] };
      await page.request.post(`${local.url}/api/projects/shop/prompts`, { data: { prompt: TODO_PROMPT } });
      await page.goto(`${local.url}/?project=shop`);
      await page.locator('#features [data-session="s1"][data-state="merged"]').waitFor({ timeout: 60_000 });
      await page.locator("#app-menu").click();
      await page.getByRole("menuitem", { name: "Agents and skills" }).click();
      const dialog = page.locator('[data-dialog="settings"]');
      const view = dialog.locator('[data-view="agents"][data-scope="app"]');
      await view.waitFor({ timeout: 10_000 });
      expect(await view.locator("[data-role]").evaluateAll((items) => items.map((i) => i.getAttribute("data-role")))).toEqual(["planner", "test", "backend", "frontend", "chore", "reviewer", "conflict-resolver", "gardener"]);
      await view.locator('[data-role="backend"]').click();
      const editor = view.locator('[data-role-editor="backend"]');
      await editor.getByLabel("System prompt").fill("Implement {feature}. Keep handlers small.");
      await editor.getByRole("button", { name: "Save" }).click();
      await expect.poll(async () => (await agents()).roles.find((r) => r.role === "backend")?.instructions, { timeout: 10_000 }).toBe("Implement {feature}. Keep handlers small.");
      await view.locator('[data-role="backend"]', { hasText: "edited" }).waitFor();

      await view.getByRole("button", { name: "Add a role" }).click();
      const added = view.locator('[data-role-editor="new"]');
      await added.getByLabel("Role id").fill("data-modeler");
      await added.getByLabel("Name").fill("Data modeler");
      await added.getByLabel("What it does").fill("Designs the tables a feature stores its data in.");
      await added.getByRole("button", { name: "Save" }).click();
      await view.locator('[data-role-editor="data-modeler"]').waitFor({ timeout: 10_000 });

      await dialog.locator('[data-settings-nav="skills"]').click();
      const skill = view.locator('[data-skill-editor="new"]');
      await skill.getByLabel("Skill name").fill("tidy-sql");
      await skill.getByLabel("When to use it").fill("Use when writing SQL queries");
      await skill.getByLabel("Instructions").fill("Keep queries short and name every column.");
      await skill.getByRole("group", { name: "Roles that use it" }).getByText("Data modeler").click();
      await skill.getByRole("button", { name: "Save" }).click();
      await view.locator('[data-skill-editor="tidy-sql"]').waitFor({ timeout: 10_000 });
      let saved = await agents();
      expect(saved.version).toBe(3);
      expect(saved.roles.find((r) => r.role === "data-modeler")).toMatchObject({ custom: true, skills: ["tidy-sql"] });

      await view.getByRole("button", { name: "New skill" }).click();
      const shared = view.locator('[data-skill-editor="new"]');
      await shared.getByLabel("Skill name").fill("house-style");
      await shared.getByLabel("When to use it").fill("Use when naming anything");
      await shared.getByLabel("Instructions").fill("Name things after what the user sees.");
      await shared.getByRole("radio", { name: "Every role" }).click();
      expect(await shared.getByRole("group", { name: "Roles that use it" }).count()).toBe(0);
      await shared.getByRole("button", { name: "Save" }).click();
      await view.locator('[data-skill-editor="house-style"]').waitFor({ timeout: 10_000 });
      saved = await agents();
      expect(saved.version).toBe(4);
      expect(saved.skills.find((s) => s.name === "house-style")).toMatchObject({ everyone: true });
      expect(await view.locator('[data-skill="house-style"]').innerText()).toContain("Every role");
      await dialog.locator('[data-settings-nav="agents"]').click();
      await view.locator('[data-role="backend"]').click();
      const option = view.locator('[data-role-editor="backend"] [data-skill-option="house-style"]');
      await expect.poll(() => option.getAttribute("data-shared")).toBe("true");
      expect(await option.locator("input").isDisabled()).toBe(true);

      await view.getByRole("button", { name: "History" }).click();
      await page.locator('[data-version="1"]').click();
      await expect.poll(async () => (await agents()).version, { timeout: 10_000 }).toBe(5);
      saved = await agents();
      expect(saved.roles.some((r) => r.role === "data-modeler")).toBe(false);
      expect(saved.skills).toEqual([]);
      expect(saved.roles.find((r) => r.role === "backend")?.instructions).toBe("Implement {feature}. Keep handlers small.");

      await dialog.getByRole("button", { name: "Close" }).click();
      await dialog.waitFor({ state: "hidden" });

      const projectAgents = async () => (await (await page.request.get(`${local.url}/api/projects/shop/agents`)).json()) as { version: number; roles: { role: string; instructions: string }[]; router: { useJev: boolean }; scope: { roles: string[]; router: boolean } };
      await page.locator("#project-settings-button").click();
      const project = page.locator('[data-dialog="project-settings"]');
      await project.locator('[data-settings-nav="agents"]').click();
      const scoped = project.locator('[data-view="agents"][data-scope="project"]');
      await scoped.locator('[data-role="backend"]', { hasText: "all projects" }).waitFor({ timeout: 10_000 });
      await scoped.locator('[data-role="backend"]').click();
      const own = scoped.locator('[data-role-editor="backend"]');
      await own.locator("[data-inherited]").waitFor();
      await own.getByLabel("System prompt").fill("Implement {feature} for shop only.");
      await own.getByRole("button", { name: "Save" }).click();
      await scoped.locator('[data-role="backend"]', { hasText: "this project" }).waitFor({ timeout: 10_000 });
      expect((await projectAgents()).roles.find((r) => r.role === "backend")?.instructions).toBe("Implement {feature} for shop only.");
      expect((await projectAgents()).scope.roles).toEqual(["backend"]);
      expect((await agents()).roles.find((r) => r.role === "backend")?.instructions).toBe("Implement {feature}. Keep handlers small.");
      await own.getByRole("button", { name: "Use the setting for all projects" }).click();
      await expect.poll(async () => (await projectAgents()).scope.roles, { timeout: 10_000 }).toEqual([]);
      expect((await projectAgents()).roles.find((r) => r.role === "backend")?.instructions).toBe("Implement {feature}. Keep handlers small.");

      await project.locator('[data-settings-nav="router"]').click();
      const router = project.locator("[data-router]");
      expect(await router.locator('[data-router-section="kinds"]').innerText()).toContain("Change: bug fix");
      await router.getByLabel("Request to route").fill("how does the todo list store items?");
      await router.getByRole("button", { name: "Route it" }).click();
      await router.locator('[data-try-result] [data-decision="question"][data-via="rules"]').waitFor({ timeout: 10_000 });
      expect(await router.locator('[data-router-section="recent"]').innerText()).toContain(TODO_PROMPT);
      await router.getByRole("radio", { name: "Planner only" }).click();
      await router.locator("[data-router-form]").getByRole("button", { name: "Save" }).click();
      await expect.poll(async () => (await projectAgents()).router.useJev, { timeout: 10_000 }).toBe(false);
      expect((await agents()).router.useJev).toBe(true);
      expect(new URL(page.url()).searchParams.get("settings")).toBe("project.router");

      await page.goto(`${local.url}/?project=shop&session=s1`);
      const team = page.locator('[data-view="feature"] [data-team]');
      await team.waitFor({ timeout: 10_000 });
      for (const role of ["planner", "test", "backend", "reviewer"]) await expect.poll(() => team.locator(`[data-member="${role}"]`).getAttribute("data-member-state"), { timeout: 10_000 }).toBe("done");
      await page.locator('[data-update-role="test"]').first().waitFor({ timeout: 10_000 });
      await team.locator('[data-member="backend"]').click();
      await page.locator('[data-role-editor="backend"]').waitFor({ timeout: 10_000 });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });

  it("runs a chore and a hotfix and marks them in the work list and on the build", async () => {
    const local = await serve({ port: 0, real: false, assets: DIST, project: "shop" });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const hotfix = (await (await page.request.post(`${local.url}/api/projects/shop/prompts`, { data: { prompt: `/hotfix ${TODO_PROMPT}` } })).json()) as { sessionId: string; decision: { hotfix?: boolean } };
      expect(hotfix.decision.hotfix).toBe(true);
      const chore = (await (await page.request.post(`${local.url}/api/projects/shop/prompts`, { data: { prompt: "/chore Explain how to run the tests in the README" } })).json()) as { sessionId: string; featureId: string };
      expect(chore.featureId).toBe("chore-explain-how-run-tests");
      await page.goto(`${local.url}/?project=shop`);
      for (const id of [hotfix.sessionId, chore.sessionId]) await page.locator(`#features [data-session="${id}"][data-state="merged"]`).waitFor({ timeout: 60_000 });
      expect(await page.locator(`#features [data-session="${hotfix.sessionId}"] [data-hotfix]`).count()).toBe(1);
      expect(await page.locator(`#features [data-session="${chore.sessionId}"] [data-chore]`).count()).toBe(1);

      await page.goto(`${local.url}/?project=shop&session=${chore.sessionId}`);
      const feature = page.locator('[data-view="feature"]');
      await feature.locator("[data-team]").waitFor({ timeout: 10_000 });
      expect(await feature.locator("header [data-chore]").count()).toBe(1);
      expect(await feature.locator("[data-team] [data-member]").evaluateAll((items) => items.map((i) => i.getAttribute("data-member")))).toEqual(["chore", "reviewer"]);

      await page.goto(`${local.url}/?project=shop&view=agents&tab=router`);
      const kinds = await page.locator('[data-router-section="kinds"]').innerText();
      expect(kinds).toContain("Chore");
      expect(kinds).toContain("Hotfix");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });

  it("asks for a missing key on the feature page, carries on once it is saved and keeps the value hidden", async () => {
    const local = await serve({ port: 0, real: false, assets: DIST, project: "shop" });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${local.url}/?project=shop`);
      const input = page.locator("#chat textarea");
      await input.fill(TODO_CLOUD_PROMPT);
      await input.press("Enter");
      const waiting = page.locator('#features [data-group="needs-you"] [data-session="s1"]');
      await waiting.waitFor({ timeout: 60_000 });
      await waiting.click();
      const prompt = page.locator('[data-view="feature"] [data-needs-keys]');
      await prompt.waitFor({ timeout: 10_000 });
      expect(await prompt.innerText()).toContain("TODOCLOUD_API_KEY");
      expect(await page.locator('[data-view="feature"]').innerText()).toContain("Waiting for TODOCLOUD_API_KEY");
      await prompt.getByLabel("Value of TODOCLOUD_API_KEY").fill("tc-secret-value-123");
      await prompt.getByRole("button", { name: "Save" }).click();
      await page.locator('[data-view="feature"][data-state="merged"]').waitFor({ timeout: 60_000 });
      expect(await page.locator("[data-needs-keys]").count()).toBe(0);

      await page.locator("#project-settings-button").click();
      await page.locator('[data-dialog="project-settings"] [data-settings-nav="environment"]').click();
      const env = page.locator('[data-dialog="project-settings"] [data-env]');
      await env.locator('[data-env-var="TODOCLOUD_API_KEY"]').waitFor({ timeout: 10_000 });
      await env.getByLabel("Name").fill("api_base_url");
      await env.getByLabel("Value").fill("https://api.todocloud.example");
      await env.getByRole("radio", { name: "Plain" }).click();
      await env.getByRole("button", { name: "Add" }).click();
      await env.locator('[data-env-var="API_BASE_URL"]').waitFor({ timeout: 10_000 });
      expect(await env.innerText()).toContain("https://api.todocloud.example");
      expect(await env.innerText()).not.toContain("tc-secret-value-123");
      const view = await (await page.request.get(`${local.url}/api/projects/shop/env`)).text();
      expect(view).not.toContain("tc-secret-value-123");
      expect(JSON.parse(view)).toMatchObject({ vars: [{ name: "API_BASE_URL", secret: false, value: "https://api.todocloud.example" }, { name: "TODOCLOUD_API_KEY", secret: true, value: null }], needs: [] });

      await page.locator('[data-dialog="project-settings"]').getByRole("button", { name: "Close" }).click();
      await page.locator("#app-menu").click();
      await page.getByRole("menuitem", { name: "Shared environment" }).click();
      const shared = page.locator('[data-dialog="settings"] [data-env]');
      await shared.waitFor({ timeout: 10_000 });
      expect(await shared.locator("[data-env-var]").count()).toBe(0);
      for (const [name, value] of [
        ["SUPPORT_EMAIL", "help@shop.example"],
        ["API_BASE_URL", "https://api.shared.example"],
      ] as const) {
        await shared.getByLabel("Name").fill(name);
        await shared.getByLabel("Value").fill(value);
        await shared.getByRole("radio", { name: "Plain" }).click();
        await shared.getByRole("button", { name: "Add" }).click();
        await shared.locator(`[data-env-var="${name}"]`).waitFor({ timeout: 10_000 });
      }
      const merged = (await (await page.request.get(`${local.url}/api/projects/shop/env`)).json()) as { vars: { name: string; value: string | null; scope?: string }[] };
      expect(merged.vars.map((v) => [v.name, v.value, v.scope ?? "project"])).toEqual([
        ["API_BASE_URL", "https://api.todocloud.example", "overrides"],
        ["SUPPORT_EMAIL", "help@shop.example", "shared"],
        ["TODOCLOUD_API_KEY", null, "project"],
      ]);
      await page.locator('[data-dialog="settings"]').getByRole("button", { name: "Close" }).click();
      await page.locator("#project-settings-button").click();
      await page.locator('[data-dialog="project-settings"] [data-settings-nav="environment"]').click();
      await env.locator('[data-env-var="SUPPORT_EMAIL"]', { hasText: "all projects" }).waitFor({ timeout: 10_000 });
      await env.getByRole("button", { name: "Use the value of API_BASE_URL for all projects" }).click();
      await expect.poll(() => env.locator('[data-env-var="API_BASE_URL"]').innerText(), { timeout: 10_000 }).toContain("https://api.shared.example");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });
});
