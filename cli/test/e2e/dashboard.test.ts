import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { serve, TODO_PROMPT, TODO_CLOUD_PROMPT, TODO_SPLIT_PROMPT } from "../../src/serve.ts";
import { REPO_ROOT } from "../../src/world.ts";

const DIST = join(REPO_ROOT, "apps", "dashboard", "dist");

describe("dashboard in a browser", () => {
  it("starts with no projects, creates one, sends a chat message through CopilotKit, follows the feature until it is merged and opens it", async () => {
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
      await setup.getByText("Create your first project").waitFor({ timeout: 10_000 });
      await setup.getByLabel("Project name").fill("shop");
      await setup.getByRole("button", { name: "Create project" }).click();
      await page.getByRole("button", { name: "Switch project" }).click();
      await page.getByRole("menuitem", { name: "shop" }).waitFor();
      await page.keyboard.press("Escape");
      expect(await page.locator("#new-project-button").count()).toBe(0);
      await page.locator("#project-settings-button").waitFor();
      await page.locator("#chat #talk-button").waitFor();
      await page.reload();
      await page.locator("#chat #talk-button").waitFor();
      expect(new URL(page.url()).searchParams.get("project")).toBe("shop");
      await page.locator("#home-link").click();
      const start = page.locator('[data-view="start"]');
      await start.waitFor({ timeout: 10_000 });
      expect(await start.locator('#recent-projects [data-project="shop"]').innerText()).toMatch(/Opened/i);
      await start.locator('#sidebar-projects [data-project="shop"]').waitFor();
      await start.locator("#start-new-project").click();
      await page.locator('[data-dialog="new-project"]').waitFor();
      await page.keyboard.press("Escape");
      await start.locator('#recent-projects [data-project="shop"]').click();
      await page.locator("#chat textarea").waitFor();
      expect(new URL(page.url()).searchParams.get("project")).toBe("shop");
      const input = page.locator("#chat textarea");
      await input.fill(TODO_PROMPT);
      await input.press("Enter");
      const card = page.locator('#chat [data-session="s1"][data-state="merged"]');
      await card.waitFor({ timeout: 60_000 });
      expect(await card.innerText()).toContain("Merged");
      expect(await card.innerText()).toContain("merged into main");
      expect(await page.locator("#chat").innerText()).toContain("On it. This is a new feature.");
      await expect.poll(() => page.locator('#features [data-session="s1"]').getAttribute("data-state"), { timeout: 10_000 }).toBe("merged");
      await page.locator('#features [data-feature="todo-add"][data-status="merged"][data-group="merged"]').waitFor();
      expect(await page.locator('#project-bar [data-chip="working"]').innerText()).toContain("Nothing running");
      expect(await page.locator('#sessions [data-view="main"]').count()).toBe(1);
      expect(await page.locator('#sessions [data-tab=":main"]').getAttribute("aria-selected")).toBe("true");
      expect(await page.locator('#sessions [aria-label="Close main"]').count()).toBe(0);
      await card.click();
      const feature = page.locator('[data-view="feature"][data-state="merged"]');
      await feature.waitFor({ timeout: 10_000 });
      expect(await page.getByRole("tab", { name: "App", exact: true }).getAttribute("aria-selected")).toBe("true");
      expect(await page.locator('#sessions [data-tab="todo-add"]').getAttribute("aria-selected")).toBe("true");
      expect(new URL(page.url()).searchParams.get("session")).toBe("s1");
      await page.getByRole("tab", { name: "Messages" }).click();
      await feature.locator('[data-review="approved"]').waitFor();
      await feature.locator('[data-gate="passed"]').waitFor();
      expect(await feature.innerText()).toContain("Merged into main");
      expect(await feature.locator("textarea").count()).toBe(0);
      await page.getByRole("tab", { name: "Checks" }).click();
      await page.getByRole("tabpanel", { name: "Checks" }).locator('[data-check][data-ok="true"]').first().waitFor({ timeout: 10_000 });
      await page.getByRole("tab", { name: "Changes" }).click();
      const branch = page.getByRole("tabpanel", { name: "Changes" });
      await branch.locator('[data-commit=":all"]').click();
      await expect.poll(() => branch.innerText(), { timeout: 10_000 }).toContain("features/todo-add/index.ts");
      expect(await page.getByRole("separator", { name: "Resize the chat" }).count()).toBe(1);
      await page.getByRole("button", { name: "Open large" }).click();
      await page.getByRole("dialog").getByRole("tabpanel", { name: "Changes" }).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "Make smaller" }).click();
      await page.locator("#sessions").getByRole("tabpanel", { name: "Changes" }).waitFor({ timeout: 10_000 });

      await page.locator('[data-view="feature"] [data-action="share"]').click();
      const share = page.locator('[data-dialog="share"]');
      await share.getByRole("button", { name: "Make a link" }).click();
      const link = await share.locator("[data-share] code").innerText();
      expect(link).toMatch(/\/s#chef_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
      await page.keyboard.press("Escape");
      await page.locator('[data-view="feature"] [data-action="share"]').click();
      expect(await share.locator("[data-share] code").innerText()).toBe(link);
      expect(await share.getByRole("button", { name: "Make a link" }).count()).toBe(0);
      await page.keyboard.press("Escape");
      const guest = await browser.newPage();
      await guest.goto(link);
      const shared = guest.locator('[data-view="shared"][data-shared="session"]');
      await shared.waitFor({ timeout: 10_000 });
      expect(await shared.locator("h1").innerText()).toBe(await page.locator('[data-view="feature"] h1').innerText());
      await guest.getByRole("tab", { name: "Changes" }).click();
      await expect.poll(() => guest.getByRole("tabpanel", { name: "Changes" }).innerText(), { timeout: 10_000 }).toContain("features/todo-add/index.ts");
      expect(await guest.locator("#chat").count()).toBe(0);
      await page.locator('[data-view="feature"] [data-action="share"]').click();
      page.once("dialog", (dialog) => void dialog.accept());
      await share.getByRole("button", { name: "Turn off" }).click();
      await share.getByRole("button", { name: "Make a link" }).waitFor({ timeout: 10_000 });
      expect(await share.locator("[data-share]").count()).toBe(0);
      await page.keyboard.press("Escape");
      await guest.reload();
      await guest.locator('[data-view="shared-error"]').waitFor({ timeout: 10_000 });
      await guest.close();

      await input.fill(TODO_SPLIT_PROMPT);
      await input.press("Enter");
      for (const id of ["shout", "reverse"]) await page.locator(`#features li:has([data-feature="todo-add"]) [data-feature="${id}"][data-status="merged"]`).waitFor({ timeout: 60_000 });
      expect(await page.locator("#chat").innerText()).toContain("On it. This is 2 features");
      await page.locator('#features [data-feature="shout"]').click();
      await page.locator('[data-view="feature"][data-feature="shout"]').waitFor({ timeout: 10_000 });
      expect(await page.getByRole("tab", { name: "App", exact: true }).getAttribute("aria-selected")).toBe("true");
      expect(await page.locator("#sessions [data-tab]").evaluateAll((tabs) => tabs.map((t) => t.getAttribute("data-tab")))).toEqual([":main", "todo-add", "shout"]);
      await page.locator("#sessions").getByRole("tabpanel", { name: "App" }).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "Close Shout a phrase" }).click();
      await page.locator('[data-view="feature"][data-feature="todo-add"]').waitFor({ timeout: 10_000 });

      await page.locator("#main-app-row").click();
      await page.locator('[data-view="main"]').waitFor({ timeout: 10_000 });
      expect(await page.locator('[data-tab=":main"]').innerText()).toContain("main");
      await page.getByRole("tab", { name: "History" }).click();
      await page.locator('[data-view="history"] [data-commit]').first().waitFor({ timeout: 10_000 });
      await page.locator('[data-view="history"] [data-commit][aria-current="true"]').waitFor();
      await page.locator('[data-view="history"] [data-commit]').first().click();
      await page.locator("[data-commit-detail] [data-file]").first().waitFor({ timeout: 10_000 });
      await page.locator("[data-commit-detail] [data-diff]").waitFor();
      await page.getByRole("tab", { name: "App", exact: true }).click();

      await page.locator('#features [data-feature="reverse"]').dblclick();
      const title = page.getByRole("textbox", { name: /^New name for/ });
      await title.fill("Flip the list");
      await title.press("Enter");
      await page.locator('#features [data-feature="reverse"]', { hasText: "Flip the list" }).waitFor({ timeout: 10_000 });

      await page.locator('#features [data-feature="reverse"]').dragTo(page.locator("#main-app-row"));
      await page.locator('#features > ul > li > div [data-feature="reverse"]').waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "More for Flip the list" }).click();
      await page.getByRole("menuitem", { name: "Move under" }).hover();
      await page.getByRole("menuitem", { name: "Shout a phrase" }).click();
      await page.locator('#features li:has([data-feature="shout"]) [data-feature="reverse"]').waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "More for Flip the list" }).click();
      await page.getByRole("menuitem", { name: "Move under" }).hover();
      await page.getByRole("menuitem", { name: "Top level" }).click();
      await page.locator('#features > ul > li > div [data-feature="reverse"]').waitFor({ timeout: 10_000 });
      await page.locator('#features [data-feature="reverse"]').dragTo(page.locator('#features [data-feature="shout"]'));
      await page.locator('#features li:has([data-feature="shout"]) [data-feature="reverse"]').waitFor({ timeout: 10_000 });

      await page.getByRole("button", { name: "More for Shout a phrase" }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      expect(await page.getByRole("alertdialog").innerText()).toContain("Flip the list goes too");
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.locator('#features [data-feature="shout"]').waitFor({ state: "detached", timeout: 30_000 });
      await page.locator('#features [data-feature="reverse"]').waitFor({ state: "detached", timeout: 10_000 });
      await page.locator('#features [data-feature="todo-add"]').waitFor();
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });

  it("onboards a model on the start page, then asks for a Cloudflare account in settings and saves them", async () => {
    const local = await serve({ port: 0, real: false, assets: DIST, settings: { TYPESAFE_API_KEY: "ts-deployment-key" } });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(local.url);
      const onboarding = page.locator('[data-view="onboarding"]');
      await onboarding.waitFor({ timeout: 10_000 });
      expect(await onboarding.innerText()).toContain("Connect a model");
      expect(await page.locator('[data-dialog="settings"]').count()).toBe(0);
      const first = onboarding.locator("#settings-llm");
      expect(await first.locator('[data-current="llm"]').getAttribute("data-set")).toBe("no");
      await first.getByRole("radio", { name: "Custom provider" }).click();
      await first.getByLabel("Base URL").fill("https://llm.example/");
      await first.getByLabel("API key").fill("sk-test-12345678");
      await first.getByRole("button", { name: "Continue" }).click();
      const setup = page.locator('[data-view="setup"]');
      await setup.waitFor({ timeout: 10_000 });
      expect(await setup.locator(".kicker").textContent()).toBe("Step 2 of 2");
      expect(await setup.innerText()).toContain("Create your first project");
      await page.keyboard.press("Control+,");
      const dialog = page.locator('[data-dialog="settings"]');
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.locator('[data-settings-nav="models"]').click();
      const claude = dialog.locator("#settings-llm");
      await expect.poll(() => claude.locator('[data-current="llm"] [data-key-hint]').getAttribute("data-key-hint"), { timeout: 10_000 }).toBe("…5678");
      expect(await claude.locator('[data-current="llm"]').innerText()).toContain("5678");
      expect(await claude.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
      await claude.getByRole("button", { name: "Replace" }).click();
      expect(await claude.getByLabel("API key").inputValue()).toBe("");
      await claude.getByRole("button", { name: "Cancel" }).click();
      await claude.getByLabel("Base URL").fill("https://other.example");
      expect(await claude.getByText("A new provider needs its key again.").count()).toBe(1);
      await claude.getByLabel("Base URL").fill("https://llm.example/");
      await claude.locator('[data-current="llm"] [data-key-hint]').waitFor();
      expect(await dialog.getByLabel("Voice model").inputValue()).toBe("gpt-realtime");
      expect(await dialog.locator('#settings-voice [data-current="voice"]').getAttribute("data-set")).toBe("no");
      expect(await dialog.locator('[data-current="jev"] [data-key-hint]').getAttribute("data-key-hint")).toBe("…-key");
      expect(await dialog.locator("#settings-jev").innerText()).toContain("comes from the deployment");
      expect(await dialog.getAttribute("data-section")).toBe("models");
      expect(await dialog.locator('[data-settings-nav="apps"] [aria-label="needs setup"]').count()).toBe(1);
      await dialog.locator('[data-settings-nav="apps"]').click();
      const cloudflare = dialog.locator("#settings-cloudflare");
      await cloudflare.getByLabel("Account id").fill("0123456789abcdef0123456789abcdef");
      await cloudflare.getByLabel("API token").fill("cf-token-abcd1234");
      await cloudflare.getByRole("button", { name: "Save" }).click();
      await expect.poll(() => cloudflare.locator('[data-current="cloudflare"]').getAttribute("data-set"), { timeout: 10_000 }).toBe("yes");
      const settings = (await (await page.request.get(`${local.url}/api/settings`)).json()) as Record<string, unknown>;
      expect(settings["llm"]).toEqual({ kind: "custom", baseUrl: "https://llm.example", keyHint: "…5678", source: "app" });
      expect(settings["cloudflare"]).toEqual({ accountId: "0123456789abcdef0123456789abcdef", keyHint: "…1234", source: "app" });
      expect(JSON.stringify(settings)).not.toContain("sk-test-12345678");
    } finally {
      await browser.close();
      await local.close();
    }
  });

  it("keeps existing projects on the start page while no model is connected", async () => {
    const local = await serve({ port: 0, real: false, assets: DIST, project: "shop", settings: { TYPESAFE_API_KEY: "ts-deployment-key" } });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(local.url);
      const start = page.locator('[data-view="start"]');
      await start.waitFor({ timeout: 10_000 });
      await start.locator('#sidebar-projects [data-project="shop"]').waitFor();
      await start.locator('#recent-projects [data-project="shop"]').waitFor();
      await start.locator("#needs-model").getByRole("button", { name: "Connect a model" }).click();
      const dialog = page.locator('[data-dialog="settings"]');
      await dialog.waitFor({ timeout: 10_000 });
      expect(await dialog.getAttribute("data-section")).toBe("models");
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
      expect(await view.locator("[data-role]").evaluateAll((items) => items.map((i) => i.getAttribute("data-role")))).toEqual(["planner", "test", "backend", "frontend", "designer", "chore", "reviewer", "conflict-resolver", "gardener"]);
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

      await page.goto(`${local.url}/?project=shop&session=s1&panel=messages`);
      const team = page.locator('[data-view="feature"] [data-team]');
      await team.waitFor({ timeout: 10_000 });
      for (const role of ["planner", "test", "backend", "reviewer"]) await expect.poll(() => team.locator(`[data-member="${role}"]`).getAttribute("data-member-state"), { timeout: 10_000 }).toBe("done");
      await page.locator('[data-update-role="test"]').first().waitFor({ timeout: 10_000 });
      await team.locator('[data-member="backend"]').click();
      const work = page.locator('[data-role-view="backend"]');
      await work.waitFor({ timeout: 10_000 });
      expect(new URL(page.url()).searchParams.get("role")).toBe("backend");
      await work.locator("[data-role-files]").waitFor({ timeout: 10_000 });
      expect(await work.locator("[data-update-role]").evaluateAll((items) => [...new Set(items.map((i) => i.getAttribute("data-update-role")))])).toEqual(["backend"]);
      await work.getByRole("button", { name: "Prompt and skills" }).click();
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

      await page.goto(`${local.url}/?project=shop&session=${chore.sessionId}&panel=messages`);
      const feature = page.locator('[data-view="feature"]');
      await feature.locator("[data-team]").waitFor({ timeout: 10_000 });
      expect(await feature.locator("header [data-chore]").count()).toBe(1);
      const asked = feature.locator('[data-command="chore"]').first();
      await asked.waitFor({ timeout: 10_000 });
      const bubble = await asked.locator("xpath=..").innerText();
      expect(bubble).toContain("Explain how to run the tests in the README");
      expect(bubble).not.toContain("/chore");
      expect(await feature.locator("[data-team] [data-member]").evaluateAll((items) => items.map((i) => i.getAttribute("data-member")))).toEqual(["chore", "reviewer"]);

      await page.goto(`${local.url}/?project=shop&settings=app.router`);
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
      const waiting = page.locator('#features [data-session="s1"][data-group="needs-you"]');
      await waiting.waitFor({ timeout: 60_000 });
      await waiting.click();
      const prompt = page.locator('[data-view="feature"] [data-needs-keys]');
      await prompt.waitFor({ timeout: 10_000 });
      expect(await prompt.innerText()).toContain("TODOCLOUD_API_KEY");
      await page.getByRole("tab", { name: "Messages" }).click();
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
  it("sets the instructions for every project and one project's goal and instructions, and edits its memory", async () => {
    const local = await serve({ port: 0, real: false, assets: DIST, project: "shop" });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${local.url}/?project=shop&settings=project.instructions`);
      const project = page.locator('[data-dialog="project-settings"]');
      const form = project.locator("#project-instructions");
      await form.waitFor({ timeout: 10_000 });
      await form.getByLabel("Project goal").fill("A todo list for a small team.");
      await form.getByLabel("Project instructions").fill("Keep every page under one screen.");
      await form.getByRole("button", { name: "Save" }).click();
      await form.getByRole("button", { name: "Save" }).and(page.locator(":disabled")).waitFor({ timeout: 10_000 });
      expect(await (await page.request.get(`${local.url}/api/projects/shop/instructions`)).json()).toMatchObject({ goal: "A todo list for a small team.", instructions: "Keep every page under one screen.", shared: "" });

      await form.getByRole("button", { name: "Edit for every project" }).click();
      const shared = page.locator('[data-dialog="settings"] #shared-instructions');
      await shared.waitFor({ timeout: 10_000 });
      await shared.getByLabel("Instructions for every project").fill("Use plain CSS.");
      await shared.getByRole("button", { name: "Save" }).click();
      await shared.getByRole("button", { name: "Save" }).and(page.locator(":disabled")).waitFor({ timeout: 10_000 });
      expect(await (await page.request.get(`${local.url}/api/instructions`)).json()).toMatchObject({ text: "Use plain CSS." });

      await page.goto(`${local.url}/?project=shop&settings=project.instructions`);
      expect(await project.locator("[data-shared-instructions]").innerText({ timeout: 10_000 })).toContain("Use plain CSS.");

      await project.locator('[data-settings-nav="memory"]').click();
      const add = project.locator("#memory-add");
      await add.getByLabel("Note title").fill("Prices are in euros");
      await add.getByLabel("Note text").fill("Show prices with the € sign.");
      await add.getByRole("button", { name: "Add" }).click();
      const note = project.locator('[data-memory="memory/notes/prices-are-in-euros.md"]');
      await note.waitFor({ timeout: 10_000 });
      await note.getByRole("button", { name: /Prices are in euros/ }).click();
      await note.getByLabel("Text of Prices are in euros").fill("# Prices are in euros\n\nShow prices with the € sign after the number.");
      await note.getByRole("button", { name: "Save" }).click();
      await page.waitForFunction(async (url) => JSON.stringify(await (await fetch(url)).json()).includes("after the number"), `${local.url}/api/projects/shop/memory`, { timeout: 10_000 });
      await project.locator('[data-memory="memory/notes/prices-are-in-euros.md"]').getByRole("button", { name: /Prices are in euros/ }).click();
      await project.locator('[data-memory="memory/notes/prices-are-in-euros.md"]').getByRole("button", { name: "Remove" }).click();
      await project.locator('[data-memory="memory/notes/prices-are-in-euros.md"]').getByRole("button", { name: "Remove" }).click();
      await project.locator('[data-memory="memory/notes/prices-are-in-euros.md"]').waitFor({ state: "detached", timeout: 10_000 });
      const main = (await (await page.request.get(`${local.url}/api/projects/shop/memory`)).json()) as { entries: { path: string }[] };
      expect(main.entries.map((e) => e.path)).not.toContain("memory/notes/prices-are-in-euros.md");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await local.close();
    }
  });
});
