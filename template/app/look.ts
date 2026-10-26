import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FONTS, isFont } from "../shared/fonts.ts";
import type { Feature } from "../shared/http.ts";
import type { LookInfo } from "../shared/meta.ts";
import { openPage } from "./browser.ts";

export interface LookProblem {
  readonly path: string;
  readonly view: string;
  readonly severity: "fail" | "warn";
  readonly message: string;
}

export const VIEWS = [
  { name: "phone", width: 390, height: 844, scheme: "light" },
  { name: "phone dark", width: 390, height: 844, scheme: "dark" },
  { name: "desktop", width: 1440, height: 900, scheme: "light" },
  { name: "desktop dark", width: 1440, height: 900, scheme: "dark" },
] as const;

interface Found {
  readonly overflow: string[];
  readonly contrast: { readonly text: string; readonly ratio: number; readonly large: boolean }[];
  readonly covered: { readonly text: string; readonly by: string }[];
  readonly clipped: string[];
  readonly fonts: string[];
}

function inspect(families: readonly string[]): Found {
  type Rgba = [number, number, number, number];
  const parse = (value: string): Rgba | null => {
    const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (!parts || parts.length < 3 || parts.some(Number.isNaN)) return null;
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => [0, 1, 2].map((i) => (top[i] ?? 0) * top[3] + (bottom[i] ?? 0) * (1 - top[3])).concat(1) as Rgba;
  const luminance = (c: Rgba) => {
    const [r, g, b] = c.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const background = (el: Element): Rgba | null => {
    const layers: Rgba[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") return null;
      const color = parse(style.backgroundColor);
      if (color && color[3] > 0) {
        layers.push(color);
        if (color[3] >= 1) break;
      }
    }
    return layers.reduceRight<Rgba>((under, layer) => over(layer, under), [255, 255, 255, 1]);
  };
  const name = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}`;
  const pinned = (el: Element | null) => {
    for (let node = el; node; node = node.parentElement) if (["fixed", "sticky"].includes(getComputedStyle(node).position)) return true;
    return false;
  };
  const texts = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !node.textContent?.trim() || el.closest("script,style,noscript,[aria-hidden=true],:disabled,[aria-disabled=true]")) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 1 || rect.height < 1 || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    texts.add(el);
  }
  const width = document.documentElement.clientWidth;
  const overflow =
    document.documentElement.scrollWidth > width + 1
      ? [...document.body.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > width + 1 && ![...el.children].some((child) => child.getBoundingClientRect().right > width + 1) && !pinned(el))
          .slice(0, 3)
          .map((el) => `${describe(el)} reaches ${Math.round(el.getBoundingClientRect().right)}px`)
      : [];
  const contrast: Found["contrast"] = [];
  const covered: Found["covered"] = [];
  const clipped: string[] = [];
  for (const el of texts) {
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    const bg = background(el);
    if (fg && bg) {
      const ink = over(fg, bg);
      const [hi, lo] = [luminance(ink), luminance(bg)].sort((a, b) => b - a) as [number, number];
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) contrast.push({ text: name(el), ratio: Math.round(ratio * 100) / 100, large });
    }
    for (let parent = el.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
      const box = getComputedStyle(parent);
      if (![box.overflowX, box.overflowY].some((v) => v === "hidden" || v === "clip") || style.textOverflow === "ellipsis") continue;
      const inner = el.getBoundingClientRect();
      const outer = parent.getBoundingClientRect();
      if (inner.right > outer.right + 2 || inner.bottom > outer.bottom + 2 || inner.left < outer.left - 2 || inner.top < outer.top - 2) {
        clipped.push(name(el));
        break;
      }
    }
  }
  const sorted = [...texts].map((el) => ({ el, rect: el.getBoundingClientRect() })).sort((a, b) => a.rect.top - b.rect.top);
  const start = scrollY;
  for (const { el } of sorted) {
    if (pinned(el)) continue;
    let rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > innerHeight) {
      scrollTo(0, scrollY + rect.top - 40);
      rect = el.getBoundingClientRect();
    }
    const hit = document.elementFromPoint(rect.left + Math.min(rect.width / 2, 40), rect.top + rect.height / 2);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !pinned(hit)) covered.push({ text: name(el), by: describe(hit) });
  }
  scrollTo(0, start);
  const used = new Set([...texts].map((el) => getComputedStyle(el).fontFamily.split(",")[0]?.replace(/["']/g, "").trim()));
  const loaded = new Set([...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replace(/["']/g, "")));
  const fonts = families.filter((family) => used.has(family) && !loaded.has(family));
  return { overflow, contrast, covered, clipped, fonts };
}

async function settle(): Promise<void> {
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (const animation of document.getAnimations()) if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
}

function problems(path: string, view: string, found: Found, errors: readonly string[]): LookProblem[] {
  const out: LookProblem[] = [];
  const add = (severity: LookProblem["severity"], message: string) => out.push({ path, view, severity, message });
  for (const error of errors) add("fail", `the page threw: ${error}`);
  if (found.overflow.length) add("fail", `the page scrolls sideways: ${found.overflow.join("; ")}`);
  for (const item of found.covered) add("fail", `"${item.text}" is covered by ${item.by}`);
  for (const text of found.clipped) add("fail", `"${text}" is cut off by a box that hides overflow`);
  for (const item of found.contrast) add(item.ratio < 3 ? "fail" : "warn", `"${item.text}" has contrast ${item.ratio}:1 with its background (needs ${item.large ? 3 : 4.5}:1)`);
  for (const family of found.fonts) add("fail", `the font ${family} did not load, so the page shows a fallback`);
  return out;
}

export async function lookAt(features: readonly Feature[], paths: readonly string[], look: LookInfo, root: string, out?: string): Promise<LookProblem[]> {
  const families = Object.values(look.fonts ?? {}).flatMap((name) => (isFont(name) ? [FONTS[name].family] : []));
  const views = VIEWS.filter((view) => !look.scheme || view.scheme === look.scheme);
  const found: LookProblem[] = [];
  if (out) await mkdir(out, { recursive: true });
  for (const path of paths) {
    const opened = await openPage(features, path, undefined, undefined, root);
    const errors: string[] = [];
    opened.page.on("pageerror", (error) => errors.push(error.message));
    try {
      for (const view of views) {
        await opened.page.setViewportSize({ width: view.width, height: view.height });
        await opened.page.emulateMedia({ colorScheme: view.scheme });
        await opened.page.evaluate(settle);
        found.push(...problems(path, view.name, await opened.page.evaluate(inspect, families), errors.splice(0)));
        if (out) await opened.page.screenshot({ path: join(out, `${path.replace(/^\//, "").replace(/\//g, "_") || "home"}-${view.name.replace(" ", "-")}.png`), fullPage: true });
      }
    } finally {
      await opened.close();
    }
  }
  return dedupe(found, views.length);
}

function dedupe(found: readonly LookProblem[], views: number): LookProblem[] {
  const grouped = new Map<string, LookProblem & { seen: string[] }>();
  for (const problem of found) {
    const key = `${problem.path}|${problem.severity}|${problem.message}`;
    const known = grouped.get(key);
    if (known) known.seen.push(problem.view);
    else grouped.set(key, { ...problem, seen: [problem.view] });
  }
  return [...grouped.values()].map(({ seen, ...problem }) => ({ ...problem, view: seen.length === views ? "every view" : seen.join(", ") }));
}
