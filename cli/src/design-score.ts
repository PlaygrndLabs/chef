import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser } from "playwright";
import type { LlmEndpoint } from "@chef/adapters/anthropic";
import { judgeDesign, type DesignScores } from "@chef/adapters/design-judge";

export interface DesignBenchResult {
  readonly name: string;
  readonly request: string;
  readonly mergeSeconds: number | null;
  readonly spent: number | null;
  readonly scores: DesignScores | null;
  readonly error: string | null;
}

interface Cell {
  readonly file: string;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const DESKTOP_TILE = 1000;
const DESKTOP_TILES = 4;
const PHONE_SCREEN = 844;
const PHONE_SCREENS = 4;

function size(file: string): { readonly width: number; readonly height: number } {
  const png = readFileSync(file);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function latest(dir: string, shots: readonly string[], name: string): string | null {
  const found = shots.filter((shot) => shot.endsWith(`-${name}.png`)).at(-1);
  return found && existsSync(join(dir, found)) ? join(dir, found) : null;
}

async function compose(browser: Browser, cells: readonly Cell[]): Promise<string> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  try {
    const html = cells.map((c) => `<div style="flex:none;width:${c.width}px;height:${c.height}px;background:#fff url('${pathToFileURL(c.file).href}') 0 -${c.y}px no-repeat"></div>`).join("");
    const file = join(dirname(cells[0]?.file ?? "."), "compose.html");
    writeFileSync(file, `<!doctype html><body style="margin:0"><div id="shot" style="display:flex;gap:16px;width:max-content;background:#888">${html}</div></body>`);
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    return (await page.locator("#shot").screenshot()).toString("base64");
  } finally {
    await page.close();
  }
}

function tiles(file: string): Cell[] {
  const { width, height } = size(file);
  const count = Math.min(DESKTOP_TILES, Math.ceil(height / DESKTOP_TILE));
  return Array.from({ length: count }, (_, i) => ({ file, y: i * DESKTOP_TILE, width, height: Math.min(DESKTOP_TILE, height - i * DESKTOP_TILE) }));
}

export async function designShots(browser: Browser, dir: string, shots: readonly string[]): Promise<{ readonly label: string; readonly png: string }[]> {
  const desktop = latest(dir, shots, "look-desktop");
  const opened = latest(dir, shots, "look-desktop-after-click");
  const dark = latest(dir, shots, "look-desktop-dark");
  const phone = latest(dir, shots, "look-phone");
  const page = opened ?? desktop;
  if (!page) throw new Error(`no screenshots of main's app in ${dir}`);
  const out: { label: string; png: string }[] = [];
  if (opened && desktop) out.push({ label: "desktop, the gate a first-time visitor sees", png: await compose(browser, tiles(desktop).slice(0, 1)) });
  const parts = tiles(page);
  for (const [i, cell] of parts.entries()) out.push({ label: `desktop, light, part ${i + 1} of ${parts.length} from the top${size(page).height > DESKTOP_TILE * DESKTOP_TILES ? " (the page goes on)" : ""}`, png: await compose(browser, [cell]) });
  if (dark) out.push({ label: "desktop with the visitor's setting on dark, top", png: await compose(browser, tiles(dark).slice(0, 1)) });
  if (phone) {
    const { width, height } = size(phone);
    const screens = Array.from({ length: Math.min(PHONE_SCREENS, Math.ceil(height / PHONE_SCREEN)) }, (_, i) => ({ file: phone, y: i * PHONE_SCREEN, width, height: Math.min(PHONE_SCREEN, height - i * PHONE_SCREEN) }));
    out.push({ label: `phone, the first ${screens.length} screens side by side, left to right`, png: await compose(browser, screens) });
  }
  return out;
}

function mergeSeconds(dir: string): number | null {
  const file = join(dir, "events.jsonl");
  if (!existsSync(file)) return null;
  const events = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { event?: { type?: string; at?: number } }).event ?? {});
  const start = events.find((e) => e.type === "route.decided")?.at;
  const merged = events.filter((e) => e.type === "main.merged").at(-1)?.at;
  return start && merged ? Math.round((merged - start) / 1000) : null;
}

function spent(dir: string): number | null {
  const file = join(dir, "usage.json");
  if (!existsSync(file)) return null;
  const usage = (JSON.parse(readFileSync(file, "utf8")) as { usage?: { spent?: unknown } }).usage;
  return typeof usage?.spent === "number" ? Math.round(usage.spent * 100) / 100 : null;
}

export async function scoreDesign(options: { readonly dir: string; readonly name: string; readonly request: string; readonly llm: LlmEndpoint; readonly model: string }): Promise<DesignBenchResult> {
  const base = { name: options.name, request: options.request, mergeSeconds: mergeSeconds(options.dir), spent: spent(options.dir) };
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const report = JSON.parse(readFileSync(join(options.dir, "report.json"), "utf8")) as { shots?: string[] };
    const shots = await designShots(browser, options.dir, report.shots ?? []);
    for (const [i, shot] of shots.entries()) writeFileSync(join(options.dir, `judged-${i + 1}.png`), Buffer.from(shot.png, "base64"));
    return { ...base, scores: await judgeDesign(options.llm, options.model, { request: options.request, shots }), error: null };
  } catch (error) {
    return { ...base, scores: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await browser.close();
  }
}

export function designTable(results: readonly DesignBenchResult[]): string {
  const cell = (n: number | undefined) => (n === undefined ? "–" : String(n));
  const rows = results.map((r) => {
    const s = r.scores;
    const time = r.mergeSeconds === null ? "not merged" : `${Math.floor(r.mergeSeconds / 60)}m${String(r.mergeSeconds % 60).padStart(2, "0")}s`;
    return `| ${r.name} | **${cell(s?.overall)}** | ${cell(s?.typography)} | ${cell(s?.color)} | ${cell(s?.layout)} | ${cell(s?.polish)} | ${cell(s?.phone)} | ${cell(s?.fit)} | ${time} | ${r.spent === null ? "–" : `$${r.spent.toFixed(2)}`} |`;
  });
  const notes = results.flatMap((r) => (r.scores ? [`**${r.name}**: ${r.scores.verdict}`, ...r.scores.fixes.map((fix) => `- ${fix}`), ""] : [`**${r.name}**: not scored: ${r.error ?? "unknown"}`, ""]));
  const scored = results.flatMap((r) => (r.scores ? [r.scores.overall] : []));
  const mean = scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null;
  return [
    `## Design benchmark${mean === null ? "" : `: ${mean} / 10`}`,
    "",
    "| App | Overall | Type | Color | Layout | Polish | Phone | Fit | Build to merge | Spent |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...notes,
    `Scored by ${results.find((r) => r.scores)?.scores?.model ?? "no model"} from the screenshots of each app's main.`,
  ].join("\n");
}
