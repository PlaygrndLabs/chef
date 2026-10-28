import type { DesignDraft, DesignView } from "@chef/core";

export type Scheme = "light" | "dark";

export interface PreviewFontFace {
  readonly data: ArrayBuffer;
  readonly weight: string;
  readonly style: string;
  readonly unicodeRange: string;
}

export interface PreviewFont {
  readonly family: string;
  readonly faces: readonly PreviewFontFace[];
}

export interface LookMessage {
  readonly chef: "look";
  readonly look: Record<string, unknown> | null;
  readonly scheme: Scheme | null;
  readonly fonts: readonly PreviewFont[];
}

export const WIDTHS = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Whole window" },
] as const;

export const COLOR_NAME = /^[a-z][a-z0-9-]{0,39}$/;
export const RADIUS = /^(0|[0-9]*\.?[0-9]+(rem|px|em))$/;

export function previewLook(draft: DesignDraft): Record<string, unknown> {
  return {
    brand: draft.brand ?? undefined,
    scheme: draft.scheme ?? undefined,
    fonts: draft.fonts,
    colors: draft.colors,
    materials: draft.materials,
    radius: draft.radius && RADIUS.test(draft.radius) ? draft.radius : undefined,
    width: draft.width ?? undefined,
  };
}

export function lookMessage(draft: DesignDraft | null, scheme: Scheme | null, fonts: readonly PreviewFont[]): LookMessage {
  return { chef: "look", look: draft ? previewLook(draft) : null, scheme, fonts };
}

export function schemesOf(draft: DesignDraft): readonly Scheme[] {
  return draft.scheme ? [draft.scheme] : ["light", "dark"];
}

export function colorOf(design: DesignView, draft: DesignDraft, scheme: Scheme, name: string): string | null {
  return draft.colors[scheme][name] ?? design.kit[scheme][name] ?? null;
}

function channels(color: string): readonly [number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())?.[1];
  if (!hex || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as readonly [number, number, number];
}

function luminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string | null, b: string | null): number | null {
  const x = a ? channels(a) : null;
  const y = b ? channels(b) : null;
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
}

export const PAIRS = [
  { fg: "fg", bg: "bg", label: "Text on the page", min: 4.5 },
  { fg: "muted", bg: "bg", label: "Quiet text on the page", min: 4.5 },
  { fg: "fg", bg: "card", label: "Text on cards", min: 4.5 },
  { fg: "primary-fg", bg: "primary", label: "Text on main buttons", min: 4.5 },
  { fg: "accent", bg: "bg", label: "Accent on the page", min: 3 },
] as const;

export interface ContrastCheck {
  readonly label: string;
  readonly ratio: number | null;
  readonly min: number;
  readonly ok: boolean | null;
}

export function contrastChecks(design: DesignView, draft: DesignDraft, scheme: Scheme): readonly ContrastCheck[] {
  return PAIRS.map((pair) => {
    const ratio = contrast(colorOf(design, draft, scheme, pair.fg), colorOf(design, draft, scheme, pair.bg));
    return { label: pair.label, ratio, min: pair.min, ok: ratio === null ? null : ratio >= pair.min };
  });
}

export function hexOf(color: string | null): string {
  const rgb = color ? channels(color) : null;
  return rgb ? `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}` : "#000000";
}

export function withColor(draft: DesignDraft, scheme: Scheme, name: string, value: string): DesignDraft {
  return { ...draft, colors: { ...draft.colors, [scheme]: { ...draft.colors[scheme], [name]: value } } };
}

export function withFont(draft: DesignDraft, role: "display" | "body" | "mono", name: string | null): DesignDraft {
  const fonts = Object.fromEntries(Object.entries(draft.fonts).filter(([key]) => key !== role));
  return { ...draft, fonts: name ? { ...fonts, [role]: name } : fonts };
}

export function withMaterial(draft: DesignDraft, name: string, value: string): DesignDraft {
  return { ...draft, materials: { ...draft.materials, [name]: value } };
}

interface Manifest {
  readonly [name: string]: { readonly family: string; readonly faces: readonly { readonly file: string; readonly weight: string; readonly style: string; readonly unicodeRange: string }[] };
}

let manifest: Promise<Manifest | null> | null = null;
const loaded = new Map<string, Promise<PreviewFont | null>>();

function readManifest(): Promise<Manifest | null> {
  manifest ??= fetch("/preview-fonts/fonts.json")
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  return manifest;
}

export function previewFont(name: string): Promise<PreviewFont | null> {
  const known = loaded.get(name);
  if (known) return known;
  const font = readManifest().then(async (all) => {
    const entry = all?.[name];
    if (!entry) return null;
    const faces = await Promise.all(
      entry.faces.map(async (face) => {
        const response = await fetch(`/${face.file}`);
        if (!response.ok) throw new Error(`${face.file}: ${response.status}`);
        return { data: await response.arrayBuffer(), weight: face.weight, style: face.style, unicodeRange: face.unicodeRange };
      }),
    );
    for (const face of faces) {
      const descriptors: FontFaceDescriptors = { weight: face.weight, style: face.style, unicodeRange: face.unicodeRange, display: "swap" };
      document.fonts.add(new FontFace(entry.family, face.data.slice(0), descriptors));
    }
    return { family: entry.family, faces };
  });
  const safe = font.catch(() => {
    loaded.delete(name);
    return null;
  });
  loaded.set(name, safe);
  return safe;
}

export async function familyOf(name: string): Promise<string | null> {
  return (await readManifest())?.[name]?.family ?? null;
}
