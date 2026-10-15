import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";

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
  finished: boolean;
  featureRoute?: number;
  removed?: { readonly project: string; readonly listed: boolean; readonly ms: number };
  readonly sent: { readonly prompt: string; readonly answered: boolean; readonly retried: boolean }[];
  readonly appLoads: { readonly name: string; readonly loadedMs: number | null; readonly timeline: { readonly ms: number; readonly phase: string; readonly steps: string }[] }[];
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

async function json<T>(page: Page, path: string, init?: { method: string; data?: unknown }): Promise<T> {
  const response = init?.method === "POST" ? await page.request.post(path, { data: init.data ?? {} }) : await page.request.get(path);
  if (!response.ok()) throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status()} ${await response.text()}`);
  return (await response.json()) as T;
}

async function createInDialog(page: Page, project: string, repo: string | undefined, report: TourReport, shot: (name: string) => Promise<void>): Promise<void> {
  await page.goto("/");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /new project/i }).first().click();
  if (repo) {
    await page.getByRole("radio", { name: "Other git host" }).click();
    await page.getByLabel("Repository URL").fill(repo);
  }
  await page.getByLabel("Project name").fill(project);
  await page.getByRole("button", { name: "Create project" }).click();
  const dialog = page.locator('[data-dialog="new-project"]');
  await page.locator("[data-setup-log-toggle]").click({ timeout: 5000 }).catch(() => undefined);
  const shotTaken = shot("new-project-setup");
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const steps = await dialog.locator("[data-step]").allInnerTexts().catch(() => [] as string[]);
    for (const step of steps.map((s) => s.split("\n")[0]?.trim() ?? "")) if (step && !report.setup.includes(step)) report.setup.push(step);
    const state = await dialog.locator("[data-setup]").getAttribute("data-setup", { timeout: 500 }).catch(() => null);
    if (state === "failed") throw new Error(`setup failed: ${(await dialog.locator("[data-setup-log]").innerText().catch(() => "")).slice(-500)}`);
    if (!(await dialog.count())) break;
    await page.waitForTimeout(150);
  }
  await shotTaken;
}

async function removeInSettings(page: Page, project: string, report: TourReport, shot: (name: string) => Promise<void>): Promise<void> {
  const started = Date.now();
  await page.goto(`/?project=${project}&settings=project.general`);
  await page.getByRole("button", { name: "Delete project" }).first().click();
  const dialog = page.locator('[data-dialog="delete-project"]');
  await dialog.getByLabel("Project name to delete").fill(project);
  await shot(`delete-${project}`);
  await dialog.getByRole("button", { name: "Delete project" }).click();
  await page.waitForURL((url) => !url.searchParams.has("project"), { timeout: 10 * 60_000 });
  await shot(`deleted-${project}`);
  const listed = (await json<{ projects: { name: string }[] }>(page, "/api/projects")).projects.some((p) => p.name === project);
  report.removed = { project, listed, ms: Date.now() - started };
  if (listed) report.errors.push(`remove: ${project} is still listed after deleting it`);
}

export async function tour(options: TourOptions): Promise<TourReport> {
  const { chromium } = await import("playwright");
  mkdirSync(options.out, { recursive: true });
  const base = options.url.replace(/\/$/, "");
  const report: TourReport = { shots: [], errors: [], projects: [], states: {}, agents: null, routed: null, setup: [], finished: false, appLoads: [], sent: [] };
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: base });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(`pageerror ${error.message}`));
    let leaving = false;
    page.on("response", (response) => {
      if (response.status() >= 400 && response.request().method() !== "HEAD") report.errors.push(`http ${response.status()} ${response.request().method()} ${response.url()}`);
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
      report.appLoads.push({ name, loadedMs, timeline });
      options.log(`${name}: ${loadedMs === null ? "did not load" : `loaded after ${loadedMs} ms`}; ${timeline.map((t) => `${t.ms}ms ${t.phase}`).join(", ")}`);
      await shot(`${name}-loaded`);
    };
    await signIn(page, `${base}/`, options.password);
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
    const prompts = (options.prompt ?? "").split("\n").map((p) => p.trim()).filter(Boolean);
    if (prompts.length > 0) {
      await go(`/?project=${project}`);
      const input = page.locator("#chat textarea");
      for (const [i, prompt] of prompts.entries()) {
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
      const sessions = await json<SessionRow[]>(page, `/api/projects/${project}/sessions`).catch(() => [] as SessionRow[]);
      for (const s of sessions) report.states[s.id] = s.machine.state === "stuck" ? `stuck: ${s.machine.reason ?? ""} ${(s.machine.feedback ?? "").slice(0, 1500)}`.trim() : s.machine.state;
      const latest = sessions.at(-1);
      await go(`/?project=${project}`);
      await shot(`round${round}-home`);
      if (latest) {
        await go(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}`);
        await shot(`round${round}-feature`);
      }
      const running = sessions.some((s) => ACTIVE.has(s.machine.state));
      if ((!running && (round > 1 || !options.prompt)) || Date.now() > deadline) {
        report.finished = !running;
        if (latest) {
          for (const panel of ["app", "messages", "changes", "details"]) {
            await go(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}&panel=${panel}`);
            await shot(`final-${panel}`);
          }
          if (await reveal(page, '[data-cf="sandbox"]')) await shot("final-details-sandbox");
        }
        const laned = sessions.filter((s) => s.lanes?.length).at(-1);
        for (const lane of laned?.lanes ?? []) {
          await go(`/?project=${project}&feature=${laned?.featureId}&session=${laned?.id}&panel=messages&role=${lane.role}`);
          await shot(`role-${lane.role}`);
          if (await reveal(page, `[data-cf="sandbox:${lane.role}"]`)) await shot(`role-${lane.role}-sandbox`);
        }
        const phone = await context.newPage();
        await phone.setViewportSize({ width: 390, height: 844 });
        await phone.goto(`/?project=${project}`);
        await shot("phone-home", phone);
        if (latest) {
          await phone.goto(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}`);
          await shot("phone-feature", phone);
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
    if (options.remove) {
      if (report.projects.includes(project) && !(options.removeExisting && options.project)) report.errors.push(`remove: ${project} was there before the tour, so the tour left it`);
      else await removeInSettings(page, project, report, shot).catch((error: unknown) => void report.errors.push(`remove: ${error instanceof Error ? error.message : String(error)}`));
    }
    return report;
  } finally {
    writeFileSync(join(options.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await browser.close();
  }
}
