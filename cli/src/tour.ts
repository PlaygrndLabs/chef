import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "playwright";

export interface TourOptions {
  readonly url: string;
  readonly password?: string | undefined;
  readonly project?: string | undefined;
  readonly prompt?: string | undefined;
  readonly repo?: string | undefined;
  readonly minutes: number;
  readonly everySeconds: number;
  readonly remove?: boolean;
  readonly removeExisting?: boolean;
  readonly appClick?: string | undefined;
  readonly image?: string | undefined;
  readonly out: string;
  readonly log: (line: string) => void;
}

interface SessionRow {
  readonly id: string;
  readonly featureId: string;
  readonly machine: { readonly state: string; readonly reason?: string; readonly feedback?: string | null };
  readonly lanes?: readonly { readonly role: string }[] | null;
}

const ACTIVE = new Set(["queued", "planning", "testing", "coding", "reviewing", "gating"]);

export interface TourReport {
  readonly shots: string[];
  readonly errors: string[];
  readonly projects: string[];
  readonly states: Record<string, string>;
  agents: { readonly version: number; readonly roles: string[]; readonly skills: number } | null;
  routed: { readonly prompt: string; readonly intent: string; readonly via: string; readonly classifier: string | null } | null;
  readonly setup: string[];
  setupSteps?: string[];
  finished: boolean;
  featureRoute?: number;
  removed?: { readonly project: string; readonly listed: boolean; readonly ms: number };
  readonly sent: { readonly prompt: string; readonly answered: boolean; readonly retried: boolean }[];
  readonly appLoads: { readonly name: string; readonly loadedMs: number | null; readonly rendered: boolean; readonly timeline: { readonly ms: number; readonly phase: string; readonly steps: string }[] }[];
  tabsKept?: { readonly app: boolean | null; readonly messages: boolean; readonly panel: string | null };
}

const SETTLE_MS = 15_000;
const APP_LOAD_MS = 120_000;
const ROUTE_PROMPT = "Add a way to mark items as done";

async function signIn(page: Page, url: string, password: string | undefined): Promise<void> {
  await page.goto(url);
  const field = page.locator('form[action="/login"] input[name="password"]');
  if (await field.count()) {
    if (!password) throw new Error("the app asks for a password: set CHEF_PASSWORD");
    await field.fill(password);
    await Promise.all([page.waitForNavigation(), page.locator('form[action="/login"] button').click()]);
    if (await field.count()) throw new Error("sign in failed: wrong CHEF_PASSWORD");
  }
}

async function answered(page: Page): Promise<"answered" | "failed" | "waiting"> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await page.locator('[data-pending="failed"]').count()) return "failed";
    if ((await page.locator("[data-pending]").count()) === 0) return "answered";
    await page.waitForTimeout(1000);
  }
  return "waiting";
}

async function reveal(page: Page, selector: string): Promise<boolean> {
  const target = page.locator(selector).first();
  if (!(await target.waitFor({ timeout: 10_000 }).then(() => true, () => false))) return false;
  await target.scrollIntoViewIfNeeded();
  return true;
}

async function keptTabs(page: Page, feature: string): Promise<{ app: boolean | null; messages: boolean; panel: string | null }> {
  const scope = `[data-kept="${feature}"]`;
  const tab = (name: string) => page.locator(`${scope} [role="tab"]`, { hasText: name }).first();
  const mark = (selector: string) =>
    page.evaluate((s) => {
      const found = document.querySelector(s);
      found?.setAttribute("data-tour-mark", "kept");
      return found !== null;
    }, selector);
  const kept = (selector: string) => page.evaluate((s) => document.querySelector(s)?.getAttribute("data-tour-mark") === "kept", selector);
  const framed = await mark(`${scope} iframe`);
  await tab("Messages").click();
  await page.waitForTimeout(800);
  await mark(`${scope} [data-messages]`);
  await page.locator('[data-tab=":main"]').click();
  await page.waitForTimeout(1500);
  await page.locator(`[data-tab="${feature}"]`).click();
  await page.waitForTimeout(800);
  const panel = await page.locator(`${scope} [role="tab"][aria-selected="true"]`).first().innerText().catch(() => null);
  const messages = await kept(`${scope} [data-messages]`);
  await tab("App").click();
  await page.waitForTimeout(800);
  return { app: framed ? await kept(`${scope} iframe`) : null, messages, panel };
}

async function json<T>(page: Page, path: string, init?: { method: string; data?: unknown }): Promise<T> {
  const response = init?.method === "POST" ? await page.request.post(path, { data: init.data ?? {} }) : await page.request.get(path);
  if (!response.ok()) throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status()} ${await response.text()}`);
  return (await response.json()) as T;
}

async function pickFromGitHub(form: Locator, repo: string): Promise<boolean> {
  const fullName = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repo)?.[1];
  if (!fullName) return false;
  await form.getByRole("radio", { name: "From GitHub" }).click();
  if (!(await form.locator('[data-github="connected"]').waitFor({ timeout: 15_000 }).then(() => true, () => false))) return false;
  const search = form.getByLabel("Search repositories");
  if (await search.count()) await search.fill(fullName);
  const pick = form.locator('[aria-label="GitHub repository"] [role="radio"]').filter({ hasText: new RegExp(`^${fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  if (!(await pick.first().waitFor({ timeout: 5000 }).then(() => true, () => false))) return false;
  await pick.first().click();
  return true;
}

async function createInDialog(page: Page, project: string, repo: string | undefined, report: TourReport, shot: (name: string) => Promise<void>): Promise<void> {
  await page.goto("/");
  await page.keyboard.press("Escape");
  const button = page.getByRole("button", { name: /new project/i }).first();
  const inDialog = await button.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  if (inDialog) await button.click();
  const form = inDialog ? page.locator('[data-dialog="new-project"]') : page.locator("body");
  if (repo && !(await pickFromGitHub(form, repo))) {
    await form.getByRole("radio", { name: "Other git host" }).click();
    await form.getByLabel("Repository URL").fill(repo);
  }
  await form.getByLabel("Project name").fill(project);
  await form.getByRole("button", { name: "Create project" }).click();
  await page.locator("[data-setup-log-toggle]").click({ timeout: 5000 }).catch(() => undefined);
  const shotTaken = shot("new-project-setup");
  const deadline = Date.now() + 180_000;
  let seen = false;
  while (Date.now() < deadline) {
    const steps = await form.locator("[data-step]").allInnerTexts().catch(() => [] as string[]);
    for (const step of steps.map((s) => s.split("\n")[0]?.trim() ?? "")) if (step && !report.setup.includes(step)) report.setup.push(step);
    if (steps.length) report.setupSteps = steps.map((s) => s.replace(/\s+/g, " ").trim());
    const state = await form.locator("[data-setup]").getAttribute("data-setup", { timeout: 500 }).catch(() => null);
    if (state === "failed") throw new Error(`setup failed: ${(await form.locator("[data-setup-log]").innerText().catch(() => "")).slice(-500)}`);
    seen ||= state !== null;
    if (inDialog ? !(await form.count()) : seen && state === null) break;
    await page.waitForTimeout(150);
  }
  await shotTaken;
}

async function removeInSettings(page: Page, project: string, report: TourReport, shot: (name: string) => Promise<void>): Promise<void> {
  const started = Date.now();
  await page.goto(`/?project=${project}&settings=project.general`);
  await page.getByRole("button", { name: "Delete project" }).first().click();
  const dialog = page.locator('[data-dialog="delete-project"]');
  const typed = dialog.getByLabel("Project name to delete");
  await dialog.getByRole("button", { name: `Copy ${project}` }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  if (copied !== project) report.errors.push(`remove: the copy button copied "${copied}", not ${project}`);
  await typed.fill(copied || project);
  await shot(`delete-${project}`);
  await dialog.getByRole("button", { name: "Delete project" }).click();
  await page.waitForURL((url) => !url.searchParams.has("project"), { timeout: 10 * 60_000 });
  await shot(`deleted-${project}`);
  const listed = (await json<{ projects: { name: string }[] }>(page, "/api/projects")).projects.some((p) => p.name === project);
  report.removed = { project, listed, ms: Date.now() - started };
  if (listed) report.errors.push(`remove: ${project} is still listed after deleting it`);
}

async function appLook(browser: Browser, from: BrowserContext, base: string, project: string, click: string | undefined, take: (name: string, page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: base, storageState: await from.storageState() });
  try {
    const look = await context.newPage();
    await look.goto(`/app/${project}/main`, { waitUntil: "networkidle" });
    await take("look-desktop", look);
    if (click) {
      const button = look.getByRole("button", { name: click }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click();
        await take("look-desktop-after-click", look);
      }
    }
    await look.emulateMedia({ colorScheme: "dark" });
    await take("look-desktop-dark", look);
    await look.emulateMedia({ colorScheme: "light" });
    await look.setViewportSize({ width: 390, height: 844 });
    await take("look-phone", look);
  } finally {
    await context.close();
  }
}

export async function tour(options: TourOptions): Promise<TourReport> {
  const { chromium } = await import("playwright");
  mkdirSync(options.out, { recursive: true });
  const base = options.url.replace(/\/$/, "");
  const report: TourReport = { shots: [], errors: [], projects: [], states: {}, agents: null, routed: null, setup: [], finished: false, appLoads: [], sent: [] };
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: base, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(`pageerror ${error.message}`));
    let leaving = false;
    let deleting: string | null = null;
    page.on("response", (response) => {
      if (deleting && response.status() === 409 && new RegExp(`/(api/projects|agents/project|app)/${deleting}[/?]`).test(response.url())) return;
      if (response.status() < 400 || response.request().method() === "HEAD") return;
      if (deleting && response.status() === 503 && new URL(response.url()).hostname.includes(`-${deleting}-`)) return;
      const line = `http ${response.status()} ${response.request().method()} ${response.url()} after ${report.shots.at(-1) ?? "the start"}${deleting ? ` while deleting ${deleting}` : ""}`;
      report.errors.push(line);
      void response.text().then(
        (body) => void (report.errors[report.errors.indexOf(line)] = `${line}: ${body.replace(/\s+/g, " ").trim().slice(0, 300)}`),
        () => undefined,
      );
    });
    page.on("console", (message) => {
      if (message.type() !== "error" || message.text().startsWith("Failed to load resource")) return;
      if (leaving && /network error/i.test(message.text())) return;
      report.errors.push(`console ${message.text()}`);
    });
    const go = async (url: string) => {
      leaving = true;
      try {
        await page.goto(url);
      } finally {
        leaving = false;
      }
    };
    let n = 0;
    const shot = async (name: string, target: Page = page) => {
      await target.waitForTimeout(1200);
      await target.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: SETTLE_MS }).catch(() => options.log(`${name}: still loading after ${SETTLE_MS / 1000}s`));
      const file = `${String(++n).padStart(3, "0")}-${name}.png`;
      await target.screenshot({ path: join(options.out, file) });
      report.shots.push(file);
      options.log(`shot ${file}`);
    };
    const watchLoad = async (url: string, name: string) => {
      const started = Date.now();
      await go(url);
      const timeline: { ms: number; phase: string; steps: string }[] = [];
      let loadedMs: number | null = null;
      let last = "";
      while (Date.now() - started < APP_LOAD_MS) {
        const phase = (await page.locator("[data-app-load]").first().getAttribute("data-app-load", { timeout: 100 }).catch(() => null)) ?? "none";
        const steps = (await page.locator("[data-app-load] [data-step]").allInnerTexts().catch(() => [] as string[])).map((step) => step.replace(/\s+/g, " ").trim()).join(" / ");
        if (`${phase}|${steps}` !== last) {
          last = `${phase}|${steps}`;
          timeline.push({ ms: Date.now() - started, phase, steps });
          const file = `${String(++n).padStart(3, "0")}-${name}-${phase}.png`;
          await page.screenshot({ path: join(options.out, file) });
          report.shots.push(file);
        }
        if (phase === "none" && (await page.locator("iframe").count()) > 0) {
          loadedMs ??= Date.now() - started;
          if (Date.now() - started - loadedMs > 1500) break;
        } else loadedMs = null;
        await page.waitForTimeout(200);
      }
      const rendered = loadedMs !== null && (await page.frameLocator("iframe").first().locator("body *:visible").first().waitFor({ timeout: 15_000 }).then(() => true, () => false));
      report.appLoads.push({ name, loadedMs, rendered, timeline });
      options.log(`${name}: ${loadedMs === null ? "did not load" : `loaded after ${loadedMs} ms${rendered ? "" : " but showed nothing"}`}; ${timeline.map((t) => `${t.ms}ms ${t.phase}`).join(", ")}`);
      await shot(`${name}-loaded`);
    };
    const linkLoad = async (project: string, name: string) => {
      const tab = await context.newPage();
      const started = Date.now();
      const timeline: { ms: number; phase: string; steps: string }[] = [];
      const note = (phase: string, steps: string) => timeline.push({ ms: Date.now() - started, phase, steps });
      tab.on("response", (response) => note("http", `${response.status()} ${response.request().method()} ${response.url().replace(/([?&]t=)[^&]+/, "$1…")}`));
      tab.on("requestfailed", (request) => note("failed", `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`));
      void tab.goto(`/app/${project}/main`, { waitUntil: "commit" }).catch((error: unknown) => note("goto", error instanceof Error ? error.message : String(error)));
      let loadedMs: number | null = null;
      while (Date.now() - started < 180_000) {
        await tab.waitForTimeout(500);
        const url = tab.url();
        if (url.startsWith("http") && new URL(url).host !== new URL(base).host && (await tab.evaluate(() => document.readyState).catch(() => "")) === "complete") {
          loadedMs = Date.now() - started;
          break;
        }
      }
      const rendered = loadedMs !== null && (await tab.locator("body *:visible").first().waitFor({ timeout: 15_000 }).then(() => true, () => false));
      report.appLoads.push({ name, loadedMs, rendered, timeline });
      options.log(`${name}: ${loadedMs === null ? "did not load" : `loaded after ${loadedMs} ms`}; ${timeline.map((t) => `${t.ms}ms ${t.phase} ${t.steps}`).join(", ")}`);
      await shot(name, tab);
      await tab.close();
    };
    await signIn(page, `${base}/`, options.password);
    if (options.project) await Promise.all([linkLoad(options.project, "main-link-cold"), watchLoad(`/?project=${options.project}&view=main`, "main-app-cold")]);
    await shot("start");
    const agents = await json<{ version: number; roles: { role: string }[]; skills: unknown[] }>(page, "/api/agents").catch((error: unknown) => {
      report.errors.push(`agents ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (agents) report.agents = { version: agents.version, roles: agents.roles.map((r) => r.role), skills: agents.skills.length };
    const listed = await json<{ projects: { name: string }[] }>(page, "/api/projects").catch(() => ({ projects: [] }));
    report.projects.push(...listed.projects.map((p) => p.name));
    for (const name of report.projects.slice(0, 4)) {
      await go(`/?project=${name}`);
      await shot(`project-${name}`);
    }
    const project = options.project ?? report.projects[0];
    if (!project) return report;
    if (!report.projects.includes(project)) {
      await createInDialog(page, project, options.repo, report, shot).catch(async (error: unknown) => {
        report.errors.push(`new project dialog ${error instanceof Error ? error.message : String(error)}`);
        await json(page, "/api/projects", { method: "POST", data: { name: project } }).catch(() => json(page, `/api/projects/${project}/bootstrap`, { method: "POST" }));
      });
      options.log(`created ${project}: ${report.setup.join(" | ")}`);
    }
    await go(`/?project=${project}`);
    await shot(`open-${project}`);
    const opened = (await json<SessionRow[]>(page, `/api/projects/${project}/sessions`).catch(() => [] as SessionRow[])).at(-1);
    if (opened) await watchLoad(`/?project=${project}&feature=${opened.featureId}&session=${opened.id}&panel=app`, "app-load");
    await watchLoad(`/?project=${project}&view=main`, "main-app-load");
    const lookAtMain = () =>
      appLook(browser, context, base, project, options.appClick, async (name, target) => {
        await target.waitForTimeout(1500);
        const file = `${String(++n).padStart(3, "0")}-${name}.png`;
        await target.screenshot({ path: join(options.out, file), fullPage: true });
        report.shots.push(file);
        options.log(`shot ${file}`);
      }).catch((error: unknown) => options.log(`app look: ${error instanceof Error ? error.message : String(error)}`));
    const prompts = (options.prompt ?? "").split("\n").map((p) => p.trim()).filter(Boolean);
    if (prompts.length === 0) await lookAtMain();
    const routed = await json<{ intent: string; via: string; classifier?: { model: string; accepted: boolean } | null }>(page, `/api/projects/${project}/route`, { method: "POST", data: { prompt: ROUTE_PROMPT } }).catch((error: unknown) => {
      report.errors.push(`route ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (routed) report.routed = { prompt: ROUTE_PROMPT, intent: routed.intent, via: routed.via, classifier: routed.classifier ? `${routed.classifier.model} ${routed.classifier.accepted ? "accepted" : "not sure"}` : null };
    for (const scope of ["app", "project"]) {
      for (const section of ["general", "agents", "skills", "router", "environment"]) {
        await go(`/?project=${project}&settings=${scope}.${section}`);
        await shot(`settings-${scope}-${section}`);
      }
    }
    if (prompts.length > 0) {
      await go(`/?project=${project}`);
      const input = page.locator("#chat textarea");
      for (const [i, prompt] of prompts.entries()) {
        if (i === 0 && options.image) {
          await attachImage(page, options.image);
          await shot("attached");
        }
        await input.fill(prompt);
        await input.press("Enter");
        const outcome = await answered(page);
        let retried = false;
        if (outcome === "failed") {
          await shot(`sent${i + 1}-failed`);
          await page.locator("[data-retry]").first().click();
          retried = true;
        }
        report.sent.push({ prompt, answered: (retried ? await answered(page) : outcome) === "answered", retried });
        await shot(prompts.length > 1 ? `sent${i + 1}` : "sent");
      }
    }
    const deadline = Date.now() + options.minutes * 60_000;
    let round = 0;
    for (;;) {
      round++;
      const sessions = await json<SessionRow[]>(page, `/api/projects/${project}/sessions`).catch((error: unknown) => {
        report.errors.push(`round ${round}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000));
        return null;
      });
      if (!sessions) {
        if (Date.now() > deadline) break;
        await page.waitForTimeout(options.everySeconds * 1000);
        continue;
      }
      for (const s of sessions) report.states[s.id] = s.machine.state === "stuck" ? `stuck: ${s.machine.reason ?? ""} ${(s.machine.feedback ?? "").slice(0, 1500)}`.trim() : s.machine.state;
      const latest = sessions.at(-1);
      await go(`/?project=${project}`);
      await shot(`round${round}-home`);
      if (latest) {
        await go(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}`);
        await shot(`round${round}-feature`);
      }
      const running = sessions.some((s) => ACTIVE.has(s.machine.state));
      if ((!running && (!options.prompt || (round > 1 && sessions.length > 0) || round > 4)) || Date.now() > deadline) {
        report.finished = !running;
        if (latest) {
          await watchLoad(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}&panel=app`, "final-app-load");
          report.tabsKept = await keptTabs(page, latest.featureId).catch(() => ({ app: false, messages: false, panel: null }));
          options.log(`tabs kept: ${JSON.stringify(report.tabsKept)}`);
          if (report.tabsKept.app === false || !report.tabsKept.messages || report.tabsKept.panel !== "Messages") report.errors.push(`tabs: switching tabs rebuilt them ${JSON.stringify(report.tabsKept)}`);
          await shot("final-tabs-kept");
          for (const panel of ["messages", "changes", "details"]) {
            await go(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}&panel=${panel}`);
            await shot(`final-${panel}`);
          }
          if (await reveal(page, '[data-cf="sandbox"] [data-cf-row]')) {
            await page.locator('[data-cf="sandbox"] [data-cf-row]').first().click();
            await shot("final-details-sandbox");
          }
          const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: base, colorScheme: "dark", storageState: await context.storageState() });
          const night = await dark.newPage();
          await night.goto(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}&panel=details`);
          await shot("final-details-dark", night);
          await dark.close();
        }
        if (prompts.length > 0) {
          await watchLoad(`/?project=${project}&view=main`, "final-main-app-load");
          await lookAtMain();
        }
        await go(`/?project=${project}&settings=project.usage`);
        await shot("project-usage");
        await go(`/?project=${project}&settings=project.design`);
        await shot("project-design");
        await go(`/?project=${project}&settings=app.usage`);
        await shot("app-usage");
        const laned = sessions.filter((s) => s.lanes?.length).at(-1);
        for (const lane of laned?.lanes ?? []) {
          await go(`/?project=${project}&feature=${laned?.featureId}&session=${laned?.id}&panel=messages&role=${lane.role}`);
          await shot(`role-${lane.role}`);
        }
        const phone = await context.newPage();
        await phone.setViewportSize({ width: 390, height: 844 });
        await phone.goto(`/?project=${project}`);
        await shot("phone-home", phone);
        if (latest) {
          await phone.goto(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}`);
          await shot("phone-feature", phone);
          await phone.goto(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}&panel=details`);
          await shot("phone-details", phone);
        }
        break;
      }
      await page.waitForTimeout(options.everySeconds * 1000);
    }
    const feature = (await json<SessionRow[]>(page, `/api/projects/${project}/sessions`).catch(() => [] as SessionRow[])).at(-1)?.featureId;
    if (feature) {
      const probe = await page.request.patch(`/api/projects/${project}/features/${feature}`, { data: {} });
      report.featureRoute = probe.status();
      if (probe.status() !== 200) report.errors.push(`feature route: an empty PATCH of ${feature} answered ${probe.status()} instead of 200`);
    }
    const events: unknown[] = [];
    for (let after = 0; ; ) {
      const page500 = await json<{ seq: number }[]>(page, `/api/projects/${project}/events?after=${after}`).catch(() => []);
      if (!page500.length) break;
      events.push(...page500);
      after = page500.at(-1)?.seq ?? after + page500.length;
    }
    writeFileSync(join(options.out, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
    const builds = await json<SessionRow[]>(page, `/api/projects/${project}/sessions`).catch(() => [] as SessionRow[]);
    const spent = {
      usage: await json<unknown>(page, `/api/projects/${project}/usage`).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })),
      builds: await Promise.all(builds.map((s) => json<unknown>(page, `/api/projects/${project}/sessions/${s.id}`).catch((error: unknown) => ({ id: s.id, error: error instanceof Error ? error.message : String(error) })))),
    };
    writeFileSync(join(options.out, "usage.json"), `${JSON.stringify(spent, null, 2)}\n`);
    if (options.remove) {
      if (report.projects.includes(project) && !(options.removeExisting && options.project)) report.errors.push(`remove: ${project} was there before the tour, so the tour left it`);
      else {
        deleting = project;
        await removeInSettings(page, project, report, shot).catch((error: unknown) => void report.errors.push(`remove: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    return report;
  } finally {
    writeFileSync(join(options.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await browser.close();
  }
}

async function attachImage(page: Page, image: string): Promise<void> {
  const chat = page.locator("#chat");
  if (/^https?:\/\//.test(image)) {
    const response = await fetch(image);
    if (!response.ok) throw new Error(`could not download ${image}: ${response.status}`);
    const mimeType = (response.headers.get("content-type") ?? "image/png").split(";")[0] ?? "image/png";
    const name = `reference.${mimeType.split("/")[1] ?? "png"}`.replace("jpeg", "jpg");
    await chat.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.from(await response.arrayBuffer()) });
  } else {
    await chat.locator('input[type="file"]').setInputFiles(image);
  }
  await chat.locator('[data-attached-image^="uploads/"]').first().waitFor({ timeout: 60_000 });
}
