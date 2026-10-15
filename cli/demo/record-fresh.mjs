import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.CHEF_URL ?? "https://chef-dev.playgrndlabs.workers.dev").replace(/\/$/, "");
const SITE = "https://chef.playgrndlabs.com/";
const OUT = process.env.OUT ?? "results/demo";
const PROJECT = process.env.PROJECT || "pageturners";
const FOLLOW_MIN = Number(process.env.MINUTES || "40");
const MODE = "build";
const PROMPTS = (process.env.PROMPT || [
  "Make a reading list for Pageturners, a small book club: members add a book with its title and author, the books are saved, and each book has a vote button that counts how many members want to read it, most votes first.",
  "Add a meetings page: schedule a meeting with a date, a place and the book to discuss, save it, and list the upcoming meetings soonest first.",
  "Add a members page where people join with their name and favorite genre, save them, and show everyone who joined with the member count at the top.",
].join("\n")).split("\n").map((p) => p.trim()).filter(Boolean);
const W = 1440;
const H = 810;
const ACTIVE = new Set(["queued", "planning", "testing", "coding", "reviewing", "gating"]);

mkdirSync(OUT, { recursive: true });
const t0 = { at: 0 };
const markers = [];
const log = (line) => process.stderr.write(`[${((Date.now() - t0.at) / 1000).toFixed(1)}s] ${line}\n`);
const mark = (name, info = {}) => {
  const entry = { t: (Date.now() - t0.at) / 1000, name, ...info };
  markers.push(entry);
  appendFileSync(join(OUT, "markers.jsonl"), `${JSON.stringify(entry)}\n`);
  log(`mark ${name} ${JSON.stringify(info)}`);
};

const CURSOR = () => {
  if (window.top !== window) return;
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.5 L13.4 20.2 L10.4 13.7 L16.5 13.7 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", width: "24px", height: "24px", pointerEvents: "none", zIndex: "2147483647", transform: `translate(${window.__demoX ?? -40}px, ${window.__demoY ?? -40}px)` });
    document.documentElement.appendChild(c);
    const ring = document.createElement("div");
    ring.id = "__demo_ring";
    Object.assign(ring.style, { position: "fixed", left: "0", top: "0", width: "36px", height: "36px", marginLeft: "-18px", marginTop: "-18px", borderRadius: "50%", border: "3px solid #004dfc", opacity: "0", pointerEvents: "none", zIndex: "2147483646", transition: "opacity 450ms ease, transform 450ms ease" });
    document.documentElement.appendChild(ring);
    document.addEventListener("mousemove", (e) => {
      window.__demoX = e.clientX;
      window.__demoY = e.clientY;
      c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }, true);
    document.addEventListener("mousedown", (e) => {
      ring.style.transition = "none";
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      ring.style.opacity = "0.9";
      ring.style.transform = "scale(0.4)";
      requestAnimationFrame(() => requestAnimationFrame(() => {
        ring.style.transition = "opacity 500ms ease, transform 500ms ease";
        ring.style.opacity = "0";
        ring.style.transform = "scale(1.4)";
      }));
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

const browser = await chromium.launch();
const signer = await browser.newContext({ baseURL: BASE });
const login = await signer.newPage();
await login.goto(`${BASE}/`);
const field = login.locator('form[action="/login"] input[name="password"]');
if (await field.count()) {
  await field.fill(process.env.CHEF_PASSWORD ?? "");
  await Promise.all([login.waitForNavigation(), login.locator('form[action="/login"] button').click()]);
}
const state = await signer.storageState();
await signer.close();

const api = await chromium.launch().then((b) => b.newContext({ baseURL: BASE, storageState: state }));
const getJson = async (path) => {
  const r = await api.request.get(path);
  if (!r.ok()) throw new Error(`${path} ${r.status()}`);
  return r.json();
};

const context = await browser.newContext({
  viewport: { width: W, height: H },
  baseURL: BASE,
  storageState: state,
  colorScheme: "light",
  recordVideo: { dir: join(OUT, "raw"), size: { width: W, height: H } },
});
await context.addInitScript(CURSOR);
const page = await context.newPage();
t0.at = Date.now();
page.on("pageerror", (e) => log(`pageerror ${e.message}`));

let mx = W / 2;
let my = H / 2;
const pause = (ms) => page.waitForTimeout(ms);
const moveTo = async (x, y, steps = 28) => {
  await page.mouse.move(x, y, { steps });
  mx = x;
  my = y;
};
const settle = async () => {
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => undefined);
};
const go = async (url) => {
  await page.goto(url).catch((e) => log(`goto ${url}: ${e.message}`));
  await page.mouse.move(mx + 1, my);
  await page.mouse.move(mx, my);
  await settle();
};
const point = async (locator, { click = true, wait = 600 } = {}) => {
  try {
    const target = locator.first();
    await target.waitFor({ state: "visible", timeout: 8000 });
    await target.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await target.boundingBox();
    if (!box) return false;
    await moveTo(box.x + Math.min(box.width / 2, 60), box.y + box.height / 2);
    await pause(250);
    if (click) await page.mouse.click(mx, my);
    await pause(wait);
    return true;
  } catch (e) {
    log(`point failed: ${e.message.split("\n")[0]}`);
    return false;
  }
};
const shotN = { n: 0 };
const shot = async (name) => {
  const file = `${String(++shotN.n).padStart(3, "0")}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) }).catch(() => undefined);
};
const glide = async (total, step = 90, delay = 120) => {
  for (let y = 0; y < total; y += step) {
    await page.mouse.wheel(0, step);
    await pause(delay);
  }
};

const sessionsOf = () => getJson(`/api/projects/${PROJECT}/sessions`).catch(() => []);
const timeline = {};
const watcher = setInterval(async () => {
  const rows = await sessionsOf();
  for (const s of rows) {
    const key = `${s.machine.state}|${(s.lanes ?? []).map((l) => `${l.role}:${l.state ?? ""}`).join(",")}`;
    if (timeline[s.id] !== key) {
      timeline[s.id] = key;
      mark("state", { session: s.id, feature: s.featureId, state: s.machine.state, reason: s.machine.reason ?? null, lanes: (s.lanes ?? []).map((l) => l.role) });
    }
  }
}, 4000);

async function landing() {
  mark("landing");
  await go(SITE);
  await moveTo(W * 0.62, H * 0.42, 20);
  await pause(7000);
  await shot("landing-hero");
  for (let i = 0; i < 6; i++) {
    await glide(H * 0.75, 60, 90);
    await pause(2600);
  }
  await shot("landing-scrolled");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(2500);
  mark("landing-end");
}

async function startPage() {
  mark("start");
  await go(`${BASE}/`);
  await page.keyboard.press("Escape").catch(() => undefined);
  await pause(3500);
  await shot("start");
}

async function createProject() {
  mark("new-project");
  await point(page.getByRole("button", { name: /new project/i }));
  const name = page.getByLabel("Project name");
  await point(name);
  await name.pressSequentially(PROJECT, { delay: 90 });
  await pause(800);
  await point(page.getByRole("button", { name: "Create project" }));
  mark("setup");
  const dialog = page.locator('[data-dialog="new-project"]');
  await point(page.locator("[data-setup-log-toggle]"), { wait: 400 });
  const deadline = Date.now() + 240_000;
  let shotTaken = false;
  while (Date.now() < deadline) {
    if (!(await dialog.count())) break;
    const s = await dialog.locator("[data-setup]").getAttribute("data-setup", { timeout: 500 }).catch(() => null);
    if (s === "failed") {
      mark("setup-failed");
      break;
    }
    if (!shotTaken && Date.now() > deadline - 220_000) {
      await shot("setup");
      shotTaken = true;
    }
    await pause(500);
  }
  mark("setup-done");
  await pause(2000);
}

async function answered() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await page.locator('[data-pending="failed"]').count()) return "failed";
    if ((await page.locator("[data-pending]").count()) === 0) return "answered";
    await pause(800);
  }
  return "waiting";
}

async function ask(prompt, i) {
  const input = page.locator("#chat textarea");
  await point(input);
  mark("typing", { i, prompt });
  await input.pressSequentially(prompt, { delay: 22 });
  await pause(700);
  await input.press("Enter");
  mark("sent", { i });
  const outcome = await answered();
  if (outcome === "failed") {
    mark("retry", { i });
    await point(page.locator("[data-retry]"));
    await answered();
  }
  mark("answered", { i, outcome });
  await pause(2500);
  await shot(`answered-${i + 1}`);
}

async function openFeature(id) {
  const row = page.locator(`#features [data-feature="${id}"]`);
  if (await point(row, { wait: 1500 })) return true;
  return false;
}

async function panel(name, wait = 5000) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await point(tab, { wait: 800 })) {
    await settle();
    await pause(wait);
    return true;
  }
  return false;
}

async function mainTab(section) {
  const tab = page.locator('[data-tab=":main"]');
  if (!(await tab.count())) {
    await go(`${BASE}/?project=${PROJECT}`);
  } else {
    await point(tab, { wait: 1200 });
  }
  if (section) await panel(section, 1500);
}

async function features() {
  const rows = await sessionsOf();
  const seen = new Map();
  for (const s of rows) seen.set(s.featureId, s);
  return [...seen.values()];
}

async function followCycle(round) {
  const list = await features();
  mark("cycle", { round, sessions: list.map((s) => `${s.featureId}:${s.machine.state}`) });
  for (const s of list) {
    if (MODE === "retry" && !ACTIVE.has(s.machine.state) && s.machine.state !== "stuck") continue;
    if (!(await openFeature(s.featureId))) continue;
    mark("feature", { feature: s.featureId, session: s.id, state: s.machine.state });
    await pause(4500);
    const team = page.locator("[data-team] button, [data-team] [title]");
    if ((await team.count()) && round % 2 === 0) {
      await point(team.first(), { click: false, wait: 2200 });
    }
    if (round % 3 === 0) {
      await panel("Messages", 6000);
      mark("messages", { feature: s.featureId });
    } else if (round % 3 === 1 && s.machine.state !== "planning" && s.machine.state !== "queued") {
      await panel("Changes", 5000);
      mark("changes", { feature: s.featureId });
    }
    await panel("App", 3500);
  }
  if (round % 2 === 1) {
    await mainTab("History");
    mark("history", { round });
    await pause(5000);
  }
}

async function follow() {
  mark("follow");
  const deadline = Date.now() + FOLLOW_MIN * 60_000;
  let round = 0;
  for (;;) {
    round++;
    await followCycle(round).catch((e) => log(`cycle ${round}: ${e.message}`));
    const rows = await sessionsOf();
    const running = rows.some((s) => ACTIVE.has(s.machine.state));
    if (rows.length && !running) {
      mark("all-done", { states: rows.map((s) => s.machine.state) });
      break;
    }
    if (Date.now() > deadline) {
      mark("deadline", { states: rows.map((s) => s.machine.state) });
      break;
    }
    if (round % 4 === 0) await shot(`round-${round}`);
  }
}

async function waitApp(ms = 90_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await page.locator("[data-add-compose]").count()) return "no-stack";
    if (!(await page.locator("[data-app-load]").count()) && (await page.locator("iframe").count())) return "app";
    await pause(500);
  }
  return "timeout";
}

const VALUES = [
  [/author/i, "Susanna Clarke"],
  [/genre/i, "Mystery"],
  [/place|where|location|venue/i, "Corner Cafe"],
  [/book|title/i, "Piranesi"],
  [/name|who/i, "Nino"],
  [/note|about|description/i, "Bring your favorite quote"],
];
const valueFor = (hint, k) => {
  for (const [re, v] of VALUES) if (re.test(hint)) return v;
  return ["Piranesi", "Nino", "Corner Cafe"][k % 3];
};

async function fillForm(frame) {
  const fields = frame.locator("form input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]), form textarea, form select");
  const n = Math.min(await fields.count().catch(() => 0), 6);
  if (!n) return false;
  for (let k = 0; k < n; k++) {
    const f = fields.nth(k);
    try {
      if (!(await f.isVisible())) continue;
      const box = await f.boundingBox();
      if (box) await moveTo(box.x + Math.min(box.width / 2, 80), box.y + box.height / 2, 18);
      const tag = await f.evaluate((el) => el.tagName.toLowerCase());
      const type = (await f.getAttribute("type")) ?? "";
      const hint = await f.evaluate((el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.labels?.[0]?.textContent].filter(Boolean).join(" "));
      if (tag === "select") {
        const options = await f.locator("option").count();
        await f.selectOption({ index: Math.min(1, options - 1) }).catch(() => undefined);
      } else if (type === "date") {
        await f.fill("2026-10-22");
      } else if (type === "datetime-local") {
        await f.fill("2026-10-22T19:00");
      } else if (type === "time") {
        await f.fill("19:00");
      } else if (type === "number") {
        await f.fill("1");
      } else {
        await f.click();
        await f.fill("");
        await f.pressSequentially(valueFor(hint, k), { delay: 55 });
      }
      await pause(350);
    } catch (e) {
      log(`field ${k}: ${e.message.split("\n")[0]}`);
    }
  }
  const submit = frame.locator("form button[type=submit], form button:not([type]), form input[type=submit]").first();
  try {
    const box = await submit.boundingBox();
    if (box) {
      await moveTo(box.x + box.width / 2, box.y + box.height / 2, 18);
      await pause(250);
      await submit.click();
      await pause(2500);
    }
  } catch (e) {
    log(`submit: ${e.message.split("\n")[0]}`);
  }
  return true;
}

async function useApp(label) {
  const frame = page.frameLocator("iframe").first();
  const chips = page.locator("[data-pages] button");
  const paths = [];
  for (let i = 0; i < Math.min(await chips.count(), 8); i++) paths.push((await chips.nth(i).textContent())?.trim() ?? "");
  mark("use-app", { label, paths });
  const order = paths.map((p, i) => ({ p, i })).filter(({ p }) => !/api|health|\.json/i.test(p));
  if (!order.length) order.push({ p: "", i: -1 });
  for (const { p, i } of order.slice(0, 4)) {
    if (i >= 0) {
      await point(chips.nth(i), { wait: 1200 });
      await waitApp(30_000);
    }
    mark("app-page", { label, path: p });
    await pause(2000);
    await fillForm(frame);
    const vote = frame.getByRole("button", { name: /vote|\+1|upvote|want to read/i });
    const votes = await vote.count().catch(() => 0);
    for (let k = 0; k < Math.min(votes, 2); k++) {
      try {
        const box = await vote.nth(k).boundingBox();
        if (!box) continue;
        await moveTo(box.x + box.width / 2, box.y + box.height / 2, 18);
        await vote.nth(k).click();
        await pause(1500);
      } catch {}
    }
    await shot(`use-${label}-${p.replace(/\W+/g, "_") || "root"}`);
    await pause(1500);
  }
}

async function overview() {
  mark("overview");
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await page.locator('[data-overview="ready"], [data-overview="failed"]').count()) break;
    await pause(1000);
  }
  await pause(3000);
  await shot("overview");
}

async function mainFirst() {
  mark("main-first");
  await mainTab("App");
  const now = await waitApp(150_000);
  mark("main-app-state", { now });
  await pause(5000);
  await shot("main-first");
}

async function showcase() {
  mark("showcase");
  await go(`${BASE}/?project=${PROJECT}`);
  await pause(2500);
  mark("feature-tree");
  const rows = page.locator("#features [data-feature]");
  const count = Math.min(await rows.count(), 12);
  for (let i = 0; i < count; i++) await point(rows.nth(i), { click: false, wait: 700 });
  await shot("feature-tree");
  const list = await features();
  for (const s of list) {
    if (!(await openFeature(s.featureId))) continue;
    mark("final-feature", { feature: s.featureId, state: s.machine.state });
    await pause(2500);
    await panel("App", 1000);
    await waitApp(120_000);
    await pause(3500);
    await shot(`final-app-${s.featureId}`);
    await panel("Changes", 5000);
    await shot(`final-changes-${s.featureId}`);
    await panel("Checks", 5000);
    await shot(`final-checks-${s.featureId}`);
    await panel("Messages", 4000);
    await page.mouse.wheel(0, 600);
    await pause(2000);
  }
  mark("main-history");
  await mainTab("History");
  await pause(3000);
  await shot("history");
  const commits = page.locator("[data-commit]");
  const n = Math.min(await commits.count(), 4);
  for (let i = 0; i < n; i++) {
    await point(commits.nth(i), { wait: 3500 });
    const files = page.locator("[data-file]");
    if (i < 2 && (await files.count()) > 1) await point(files.nth(1), { wait: 3000 });
  }
  mark("main-live");
  await mainTab("App");
  const now = await waitApp(180_000);
  mark("main-final-state", { now });
  await pause(4000);
  await shot("main-final");
  if (now === "app") await useApp("main");
  await pause(3000);
  mark("settings-merging");
  await go(`${BASE}/?project=${PROJECT}&settings=project.general`);
  await pause(2500);
  const merging = page.getByText("Merging", { exact: false }).first();
  await merging.scrollIntoViewIfNeeded().catch(() => undefined);
  await point(merging, { click: false, wait: 3500 });
  await shot("settings-merging");
  await page.keyboard.press("Escape").catch(() => undefined);
  mark("end");
}

try {
  await startPage().catch((e) => log(`start: ${e.message}`));
  const listed = await getJson("/api/projects").catch(() => ({ projects: [] }));
  const exists = listed.projects.some((p) => p.name === PROJECT);
  if (!exists) await createProject().catch((e) => log(`create: ${e.message}`));
  await go(`${BASE}/?project=${PROJECT}`);
  mark("project");
  await pause(3000);
  await shot("project");
  await overview().catch((e) => log(`overview: ${e.message}`));
  await mainFirst().catch((e) => log(`main-first: ${e.message}`));
  const before = await sessionsOf();
  if (!before.length || process.env.FORCE_PROMPTS) {
    await go(`${BASE}/?project=${PROJECT}`);
    await pause(2000);
    for (const [i, p] of PROMPTS.entries()) await ask(p, i).catch((e) => log(`ask ${i}: ${e.message}`));
  }
  await follow();
  await showcase().catch((e) => log(`showcase: ${e.message}`));
} catch (e) {
  log(`fatal: ${e.message}`);
} finally {
  clearInterval(watcher);
  const events = [];
  for (let after = 0; ; ) {
    const batch = await getJson(`/api/projects/${PROJECT}/events?after=${after}`).catch(() => []);
    if (!batch.length) break;
    events.push(...batch);
    after = batch.at(-1)?.seq ?? after + batch.length;
  }
  writeFileSync(join(OUT, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
  writeFileSync(join(OUT, "sessions.json"), JSON.stringify(await sessionsOf(), null, 2));
  writeFileSync(join(OUT, "markers.json"), JSON.stringify(markers, null, 2));
  await page.close();
  await context.close();
  await browser.close();
  process.exit(0);
}
