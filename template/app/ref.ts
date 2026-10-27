import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  readonly kind: "site" | "image";
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
      kind: "site",
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

interface Bin {
  readonly color: [number, number, number];
  readonly share: number;
  readonly flat: number;
}

const IMAGE_TYPES: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" };

async function pixels(data: { readonly src: string }): Promise<{ readonly bins: Bin[]; readonly edge: [number, number, number] | null; readonly width: number; readonly height: number }> {
  const image = new Image();
  image.src = data.src;
  await image.decode();
  const scale = Math.min(1, Math.sqrt(2_000_000 / (image.naturalWidth * image.naturalHeight)));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("this browser cannot read images");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);
  const { data: rgba } = context.getImageData(0, 0, width, height);
  const exact = new Map<number, number>();
  const flat = new Map<number, number>();
  const edges = new Map<number, number>();
  const frame = Math.max(1, Math.round(Math.min(width, height) * 0.03));
  let counted = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if ((rgba[i + 3] ?? 0) < 128) continue;
      const key = ((rgba[i] ?? 0) << 16) | ((rgba[i + 1] ?? 0) << 8) | (rgba[i + 2] ?? 0);
      exact.set(key, (exact.get(key) ?? 0) + 1);
      const same = (j: number) => rgba[j] === rgba[i] && rgba[j + 1] === rgba[i + 1] && rgba[j + 2] === rgba[i + 2];
      const even = (x + 1 < width && same(i + 4)) || (y + 1 < height && same(i + width * 4));
      if (even) flat.set(key, (flat.get(key) ?? 0) + 1);
      counted++;
      if (even && (x < frame || y < frame || x >= width - frame || y >= height - frame)) edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const rgb = (key: number): [number, number, number] => [(key >> 16) & 255, (key >> 8) & 255, key & 255];
  const coarse = new Map<number, { top: number; most: number; count: number; flat: number }>();
  for (const [key, count] of exact) {
    const bin = ((key >> 19) << 10) | (((key >> 11) & 31) << 5) | ((key >> 3) & 31);
    const known = coarse.get(bin) ?? { top: key, most: 0, count: 0, flat: 0 };
    if (count > known.most) Object.assign(known, { top: key, most: count });
    known.count += count;
    known.flat += flat.get(key) ?? 0;
    coarse.set(bin, known);
  }
  const edgeKey = [...edges.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const bins = [...coarse.values()].filter((bin) => bin.count / counted >= 0.0005).map((bin) => ({ color: rgb(bin.top), share: bin.count / counted, flat: bin.flat / counted }));
  return { bins, edge: edgeKey === undefined ? null : rgb(edgeKey), width: image.naturalWidth, height: image.naturalHeight };
}

const toHex = (c: readonly number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
const luminance = (c: readonly number[]) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: readonly number[], b: readonly number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const vivid = (c: readonly number[]) => (Math.max(...c) - Math.min(...c)) / 255 > 0.18;

export function imagePalette(bins: readonly Bin[], edge: readonly number[] | null): Reference["colors"] {
  const groups: { color: number[]; share: number; flat: number }[] = [];
  for (const bin of [...bins].sort((a, b) => b.share - a.share)) {
    const near = groups.find((group) => distance(group.color, bin.color) < 12);
    if (near) {
      near.share += bin.share;
      near.flat += bin.flat;
    } else groups.push({ color: [...bin.color], share: bin.share, flat: bin.flat });
  }
  const bg = (edge ? groups.find((group) => distance(group.color, edge) < 12) : undefined) ?? groups[0];
  if (!bg) return { bg: "#ffffff", fg: "#111111", surfaces: [], accents: [] };
  const rest = groups.filter((group) => group !== bg && distance(group.color, bg.color) >= 10);
  const readable = rest.filter((group) => group.flat >= 0.002 && contrast(group.color, bg.color) >= 4.5);
  const fg = readable.sort((a, b) => Number(vivid(a.color)) - Number(vivid(b.color)) || b.flat - a.flat)[0] ?? rest.sort((a, b) => contrast(b.color, bg.color) - contrast(a.color, bg.color))[0];
  const fills = rest.filter((group) => group !== fg && group.flat >= group.share * 0.6).sort((a, b) => b.flat - a.flat);
  return {
    bg: toHex(bg.color),
    fg: fg ? toHex(fg.color) : luminance(bg.color) > 0.4 ? "#111111" : "#f5f5f5",
    surfaces: fills.filter((group) => !vivid(group.color) && group.flat >= 0.02).slice(0, 4).map((group) => toHex(group.color)),
    accents: fills.filter((group) => vivid(group.color) && group.flat >= 0.004).slice(0, 6).map((group) => toHex(group.color)),
  };
}

export function imageType(name: string, type: string | null): string | null {
  const declared = type?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (declared.startsWith("image/") && declared !== "image/svg+xml") return declared;
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? (IMAGE_TYPES[ext] ?? null) : null;
}

export async function imageReference(source: string, bytes: Buffer, type: string, out?: string): Promise<Reference> {
  const context = await (await browser()).newContext();
  try {
    const page = await context.newPage();
    const read = await page.evaluate(pixels, { src: `data:${type};base64,${bytes.toString("base64")}` });
    const shots: string[] = [];
    if (out) {
      await mkdir(out, { recursive: true });
      const file = join(out, `ref-image.${Object.entries(IMAGE_TYPES).find(([, known]) => known === type)?.[0] ?? "png"}`);
      await writeFile(file, bytes);
      shots.push(file);
    }
    return { url: source, kind: "image", title: `${read.width}x${read.height} image`, fonts: { display: null, body: null }, colors: imagePalette(read.bins, read.edge), button: null, radius: null, shots };
  } finally {
    await context.close();
  }
}

export const UPLOADS_ADDRESS = "http://198.18.0.4";

export function uploadAddress(source: string): string {
  const name = /^uploads\/([\w.-]+)$/.exec(source)?.[1];
  return name ? `${UPLOADS_ADDRESS}/${name}` : source;
}

export async function referenceOf(source: string, out?: string): Promise<Reference> {
  if (!/^https?:\/\//.test(source)) {
    const type = imageType(source, null);
    if (!type) throw new Error("give a site address, an image address, or the path of a png, jpg, webp, gif or avif file");
    return imageReference(source, await readFile(source), type, out);
  }
  const response = await fetch(source, { redirect: "follow" }).catch(() => null);
  const type = response ? imageType(new URL(response.url || source).pathname, response.headers.get("content-type")) : null;
  if (response?.ok && type) return imageReference(source, Buffer.from(await response.arrayBuffer()), type, out);
  await response?.body?.cancel().catch(() => undefined);
  return reference(source, out);
}

function describe(font: RefFont | null): string {
  if (!font) return "none found";
  return `"${font.family}" ${font.size}px, weight ${font.weight}${font.upper ? ", all caps" : ""} -> ${font.closest ?? "no close match"}`;
}

export function summary(ref: Reference): string {
  const rem = ref.radius ? `${Math.round((ref.radius / 16) * 100) / 100}rem` : null;
  const colors: Record<string, string> = { bg: ref.colors.bg, fg: ref.colors.fg };
  if (ref.colors.surfaces[0]) colors["card"] = ref.colors.surfaces[0];
  if (ref.button) {
    colors["primary"] = ref.button.bg;
    colors["primary-fg"] = ref.button.fg;
  }
  if (ref.colors.accents[0]) colors["accent"] = ref.colors.accents[0];
  const fonts: Record<string, string> = {};
  if (ref.fonts.display?.closest) fonts["display"] = ref.fonts.display.closest;
  if (ref.fonts.body?.closest) fonts["body"] = ref.fonts.body.closest;
  const dark = luminance([1, 3, 5].map((i) => parseInt(ref.colors.bg.slice(i, i + 2), 16))) < 0.2;
  const scheme = dark ? "dark" : "light";
  const look = { ...(ref.kind === "site" ? { fonts } : {}), scheme, colors: { [scheme]: colors }, ...(rem ? { radius: rem } : {}), references: [ref.url] };
  const image = ref.kind === "image";
  return [
    `reference ${ref.url}${ref.title ? ` (${ref.title})` : ""}`,
    ...(image
      ? [`fonts: an image has no font names. Open it, judge each face (serif or sans, condensed or wide, its weight) and pick the closest from shared/fonts.ts`]
      : [`display font: ${describe(ref.fonts.display)}`, `body font: ${describe(ref.fonts.body)}`]),
    `page ${ref.colors.bg} (${scheme}), text ${ref.colors.fg}${ref.colors.surfaces.length ? `, surfaces ${ref.colors.surfaces.join(" ")}` : ""}`,
    `accents: ${ref.colors.accents.join(" ") || "none"}`,
    image ? `buttons and corners: read them off the image` : `buttons: ${ref.button ? `${ref.button.bg} with ${ref.button.fg} text${ref.button.pill ? ", pill shaped" : ""}` : "none found"}`,
    ...(image ? [] : [`corners: ${ref.radius ? `${ref.radius}px (${rem})` : "square"}`]),
    ...(ref.shots.length ? [`${image ? "the image" : "screenshots"}: ${ref.shots.join(" ")}`] : []),
    `a starting look, to adjust by eye against the ${image ? "image" : "screenshots"}:`,
    `export const look = ${JSON.stringify(look, null, 2)} as const;`,
  ].join("\n");
}
