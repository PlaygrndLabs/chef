import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";

export interface TourOptions {
  readonly url: string;
  readonly password?: string | undefined;
  readonly project?: string | undefined;
  readonly prompt?: string | undefined;
  readonly minutes: number;
  readonly everySeconds: number;
  readonly out: string;
  readonly log: (line: string) => void;
}

interface SessionRow {
  readonly id: string;
  readonly featureId: string;
  readonly machine: { readonly state: string };
}

const ACTIVE = new Set(["queued", "planning", "testing", "coding", "reviewing", "gating"]);

export interface TourReport {
  readonly shots: string[];
  readonly errors: string[];
  readonly projects: string[];
  readonly states: Record<string, string>;
  finished: boolean;
}

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

async function json<T>(page: Page, path: string, init?: { method: string; data?: unknown }): Promise<T> {
  const response = init?.method === "POST" ? await page.request.post(path, { data: init.data ?? {} }) : await page.request.get(path);
  if (!response.ok()) throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status()} ${await response.text()}`);
  return (await response.json()) as T;
}

export async function tour(options: TourOptions): Promise<TourReport> {
  const { chromium } = await import("playwright");
  mkdirSync(options.out, { recursive: true });
  const base = options.url.replace(/\/$/, "");
  const report: TourReport = { shots: [], errors: [], projects: [], states: {}, finished: false };
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: base });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(`pageerror ${error.message}`));
    let leaving = false;
    page.on("console", (message) => {
      if (message.type() !== "error") return;
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
      const file = `${String(++n).padStart(3, "0")}-${name}.png`;
      await target.screenshot({ path: join(options.out, file) });
      report.shots.push(file);
      options.log(`shot ${file}`);
    };
    await signIn(page, `${base}/`, options.password);
    await shot("start");
    const listed = await json<{ projects: { name: string }[] }>(page, "/api/projects").catch(() => ({ projects: [] }));
    report.projects.push(...listed.projects.map((p) => p.name));
    for (const name of report.projects.slice(0, 4)) {
      await go(`/?project=${name}`);
      await shot(`project-${name}`);
    }
    const project = options.project ?? report.projects[0];
    if (!project) return report;
    if (!report.projects.includes(project)) {
      await json(page, "/api/projects", { method: "POST", data: { name: project } }).catch(() => json(page, `/api/projects/${project}/bootstrap`, { method: "POST" }));
      options.log(`created ${project}`);
    }
    await go(`/?project=${project}`);
    await shot(`open-${project}`);
    if (options.prompt) {
      const input = page.locator("#chat textarea");
      await input.fill(options.prompt);
      await input.press("Enter");
      await shot("sent");
    }
    const deadline = Date.now() + options.minutes * 60_000;
    let round = 0;
    for (;;) {
      round++;
      const sessions = await json<SessionRow[]>(page, `/api/projects/${project}/sessions`).catch(() => [] as SessionRow[]);
      for (const s of sessions) report.states[s.id] = s.machine.state;
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
          for (const panel of ["preview", "changes", "details"]) {
            await go(`/?project=${project}&feature=${latest.featureId}&session=${latest.id}&panel=${panel}`);
            await shot(`final-${panel}`);
          }
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
    const events: unknown[] = [];
    for (let after = 0; ; ) {
      const page500 = await json<{ seq: number }[]>(page, `/api/projects/${project}/events?after=${after}`).catch(() => []);
      if (!page500.length) break;
      events.push(...page500);
      after = page500.at(-1)?.seq ?? after + page500.length;
    }
    writeFileSync(join(options.out, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
    return report;
  } finally {
    writeFileSync(join(options.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await browser.close();
  }
}
