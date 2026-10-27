import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { FONTS, isFont, type Font, type FontName } from "../shared/fonts.ts";
import { browser } from "./browser.ts";
import { fontAssets } from "./fonts.ts";

export interface RefFont {
  readonly family: string;
  readonly size: number;
  readonly weight: number;
  readonly upper: boolean;
  readonly ratio: number;
  readonly closest: FontName | null;
}

export interface Reference {
  readonly url: string;
  readonly title: string;
  readonly fonts: { readonly display: RefFont | null; readonly body: RefFont | null };
  readonly colors: { readonly bg: string; readonly fg: string; readonly surfaces: readonly string[]; readonly accents: readonly string[] };
  readonly button: { readonly bg: string; readonly fg: string; readonly pill: boolean } | null;
  readonly radius: number | null;
  readonly shots: readonly string[];
}

interface Measured {
  readonly title: string;
  readonly display: Omit<RefFont, "closest"> | null;
  readonly body: Omit<RefFont, "closest"> | null;
  readonly bg: string;
  readonly fg: string;
  readonly surfaces: readonly string[];
  readonly accents: readonly string[];
  readonly button: Reference["button"];
  readonly radius: number | null;
}

const PROBE = "HAMBURGEFONSTIV hamburgefonstiv";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

function measure(probe: string): Measured {
  const hex = (value: string): string | null => {
    const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (!parts || parts.length < 3 || (parts[3] ?? 1) < 0.5) return null;
    return `#${parts
      .slice(0, 3)
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")}`;
  };
  const saturated = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min > 0.18;
  };
  const top = (weights: Map<string, number>, skip: readonly string[] = [], n = 6) =>
    [...weights.entries()]
      .filter(([color]) => !skip.includes(color))
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([color]) => color);
  const add = (weights: Map<string, number>, key: string | null, weight: number) => {
    if (key) weights.set(key, (weights.get(key) ?? 0) + weight);
  };
  const ratio = (style: CSSStyleDeclaration) => {
    const span = document.createElement("span");
    span.textContent = probe;
    span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:${style.fontFamily};font-weight:${style.fontWeight};font-style:${style.fontStyle};font-size:100px;letter-spacing:normal;text-transform:none`;
    document.body.append(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return Math.round((width / 100) * 1000) / 1000;
  };
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && Number(style.opacity) > 0 && style.display !== "none";
  };
  const font = (el: Element | undefined) => {
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      family: style.fontFamily.split(",")[0]?.replace(/["']/g, "").trim() ?? "",
      size: Math.round(parseFloat(style.fontSize)),
      weight: Number(style.fontWeight) || 400,
      upper: style.textTransform === "uppercase" || ((el.textContent ?? "").trim().length > 3 && (el.textContent ?? "") === (el.textContent ?? "").toUpperCase()),
      ratio: ratio(style),
    };
  };
  const texts = [...document.body.querySelectorAll("h1,h2,h3,p,li,span,a,button,div")].filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()));
  const biggest = [...texts].sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];
  const families = new Map<Element, number>();
  for (const el of texts) if (el.matches("p,li")) families.set(el, (el.textContent ?? "").length);
  const body = [...families.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? document.body;
  const bg = hex(getComputedStyle(document.body).backgroundColor) ?? hex(getComputedStyle(document.documentElement).backgroundColor) ?? "#ffffff";
  const ink = new Map<string, number>();
  for (const el of texts) add(ink, hex(getComputedStyle(el).color), (el.textContent ?? "").trim().length);
  const area = new Map<string, number>();
  const radii = new Map<number, number>();
  const page = document.documentElement.scrollWidth * Math.max(document.documentElement.scrollHeight, innerHeight);
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const color = hex(style.backgroundColor);
    const rect = el.getBoundingClientRect();
    if (color && color !== bg) add(area, color, (rect.width * rect.height) / page);
    const radius = parseFloat(style.borderTopLeftRadius);
    if ((color || style.borderTopStyle !== "none") && radius > 0 && radius < rect.height / 2 && rect.width * rect.height > 20000) radii.set(radius, (radii.get(radius) ?? 0) + rect.width * rect.height);
  }
  const buttons = new Map<string, { bg: string; fg: string; pill: boolean; count: number }>();
  for (const el of document.body.querySelectorAll("a,button,[role=button]")) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const fill = hex(style.backgroundColor);
    const text = hex(style.color);
    if (!fill || !text || fill === bg || !(el.textContent ?? "").trim()) continue;
    const rect = el.getBoundingClientRect();
    const key = `${fill}|${text}`;
    const known = buttons.get(key);
    buttons.set(key, { bg: fill, fg: text, pill: parseFloat(style.borderTopLeftRadius) >= rect.height / 2 - 1, count: (known?.count ?? 0) + 1 });
  }
  const button = [...buttons.values()].sort((a, b) => b.count - a.count)[0];
  const fg = top(ink, [], 1)[0] ?? "#111111";
  const fills = top(area, [bg, fg], 12);
  return {
    title: document.title,
    display: font(biggest),
    body: font(body),
    bg,
    fg,
    surfaces: fills.filter((color) => !saturated(color)).slice(0, 4),
    accents: fills.filter(saturated).slice(0, 6),
    button: button ? { bg: button.bg, fg: button.fg, pill: button.pill } : null,
    radius: [...radii.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

function kind(font: Font): "serif" | "mono" | "sans" {
  if (font.fallback.includes("monospace")) return "mono";
  if (font.fallback.startsWith("ui-serif")) return "serif";
  return "sans";
}

function kindOf(family: string): "serif" | "mono" | "sans" {
  if (/mono|code|courier/i.test(family)) return "mono";
  if (/sans|grotesk|gothic|helvetica|arial|system/i.test(family)) return "sans";
  if (/serif|garamond|times|georgia|caslon|baskerville|didot|bodoni|tiempos|canela|editorial|playfair|fraunces/i.test(family)) return "serif";
  return "sans";
}

async function catalogRatios(page: Page, weight: number): Promise<Map<FontName, number>> {
  const names = Object.keys(FONTS) as FontName[];
  const ratios = await page.evaluate(
    async ({ families, probe, weight }) => {
      await Promise.all(families.map((family) => document.fonts.load(`${weight} 100px "${family}"`).catch(() => [])));
      return families.map((family) => {
        const span = document.createElement("span");
        span.textContent = probe;
        span.style.cssText = `position:absolute;white-space:nowrap;font-family:"${family}";font-weight:${weight};font-size:100px`;
        document.body.append(span);
        const width = span.getBoundingClientRect().width;
        span.remove();
        return Math.round((width / 100) * 1000) / 1000;
      });
    },
    { families: names.map((name) => FONTS[name].family), probe: PROBE, weight },
  );
  return new Map(names.map((name, i) => [name, ratios[i] ?? 0]));
}

async function closest(page: Page, font: Omit<RefFont, "closest"> | null): Promise<RefFont | null> {
  if (!font) return null;
  const named = (Object.keys(FONTS) as FontName[]).find((name) => name.toLowerCase() === font.family.toLowerCase() || FONTS[name].family.toLowerCase() === font.family.toLowerCase());
  if (named && isFont(named)) return { ...font, closest: named };
  const ratios = await catalogRatios(page, font.weight);
  const want = kindOf(font.family);
  const candidates = [...ratios.entries()].filter(([name, ratio]) => ratio > 0 && kind(FONTS[name]) === want);
  const best = candidates.sort((a, b) => Math.abs(a[1] - font.ratio) - Math.abs(b[1] - font.ratio))[0];
  return { ...font, closest: best?.[0] ?? null };
}

async function catalogPage(page: Page): Promise<void> {
  const modules = join(ROOT, "node_modules");
  const sheets: string[] = [];
  const files = new Map<string, string>();
  for (const name of Object.keys(FONTS) as FontName[]) {
    const assets = await fontAssets({ display: name }, modules).catch(() => null);
    if (!assets) continue;
    sheets.push(assets.css.replace(/:root\{[^}]*\}/, ""));
    for (const [file, path] of assets.files) files.set(file, path);
  }
  await page.route("http://fonts.test/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/") return route.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: `<!doctype html><style>${sheets.join("\n")}</style><body></body>` });
    const source = files.get(pathname.replace(/^\/fonts\//, ""));
    if (!source) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, headers: { "content-type": source.endsWith(".woff") ? "font/woff" : "font/woff2" }, body: await readFile(source) });
  });
  await page.goto("http://fonts.test/");
}

export async function reference(url: string, out?: string): Promise<Reference> {
  const context = await (await browser()).newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(30000);
  const shots: string[] = [];
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    const measured = await page.evaluate(measure, PROBE);
    if (out) {
      await mkdir(out, { recursive: true });
      for (const view of VIEWS) {
        await page.setViewportSize({ width: view.width, height: view.height });
        await page.waitForTimeout(500);
        const top = join(out, `ref-${view.name}-top.png`);
        await page.screenshot({ path: top });
        const full = join(out, `ref-${view.name}.png`);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.screenshot({ path: full, fullPage: height <= 8000, ...(height > 8000 ? { clip: { x: 0, y: 0, width: view.width, height: 8000 } } : {}) });
        shots.push(top, full);
      }
    }
    const fonts = await context.newPage();
    await catalogPage(fonts);
    return {
      url,
      title: measured.title,
      fonts: { display: await closest(fonts, measured.display), body: await closest(fonts, measured.body) },
      colors: { bg: measured.bg, fg: measured.fg, surfaces: measured.surfaces, accents: measured.accents },
      button: measured.button,
      radius: measured.radius,
      shots,
    };
  } finally {
    await context.close();
  }
}

function describe(font: RefFont | null): string {
  if (!font) return "none found";
  return `"${font.family}" ${font.size}px, weight ${font.weight}${font.upper ? ", all caps" : ""} -> ${font.closest ?? "no close match"}`;
}

export function summary(ref: Reference): string {
  const rem = ref.radius ? `${Math.round((ref.radius / 16) * 100) / 100}rem` : null;
  const light: Record<string, string> = { bg: ref.colors.bg, fg: ref.colors.fg };
  if (ref.colors.surfaces[0]) light["card"] = ref.colors.surfaces[0];
  if (ref.button) {
    light["primary"] = ref.button.bg;
    light["primary-fg"] = ref.button.fg;
  }
  if (ref.colors.accents[0]) light["accent"] = ref.colors.accents[0];
  const fonts: Record<string, string> = {};
  if (ref.fonts.display?.closest) fonts["display"] = ref.fonts.display.closest;
  if (ref.fonts.body?.closest) fonts["body"] = ref.fonts.body.closest;
  const look = { fonts, colors: { light }, ...(rem ? { radius: rem } : {}), references: [ref.url] };
  return [
    `reference ${ref.url}${ref.title ? ` (${ref.title})` : ""}`,
    `display font: ${describe(ref.fonts.display)}`,
    `body font: ${describe(ref.fonts.body)}`,
    `page ${ref.colors.bg}, text ${ref.colors.fg}${ref.colors.surfaces.length ? `, surfaces ${ref.colors.surfaces.join(" ")}` : ""}`,
    `accents: ${ref.colors.accents.join(" ") || "none"}`,
    `buttons: ${ref.button ? `${ref.button.bg} with ${ref.button.fg} text${ref.button.pill ? ", pill shaped" : ""}` : "none found"}`,
    `corners: ${ref.radius ? `${ref.radius}px (${rem})` : "square"}`,
    ...(ref.shots.length ? [`screenshots: ${ref.shots.join(" ")}`] : []),
    `a starting look, to adjust by eye against the screenshots:`,
    `export const look = ${JSON.stringify(look, null, 2)} as const;`,
  ].join("\n");
}
