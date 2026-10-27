import type { FontName, FontRole } from "./fonts.ts";
import { isPage, matchPath } from "./paths.ts";

export interface PageInfo {
  readonly path: string;
  readonly title: string;
  readonly description?: string;
  readonly nav?: boolean;
}

export type ColorToken = "bg" | "fg" | "card" | "muted" | "muted-bg" | "border" | "input" | "ring" | "primary" | "primary-fg" | "accent" | "danger" | "success" | "warning" | "info";

export type Colors = Partial<Record<ColorToken, string>>;

export interface LookInfo {
  readonly brand?: string;
  readonly description?: string;
  readonly scheme?: "light" | "dark";
  readonly fonts?: Partial<Record<FontRole, FontName>>;
  readonly colors?: { readonly light?: Colors; readonly dark?: Colors };
  readonly radius?: string;
  readonly gate?: string;
  readonly references?: readonly string[];
  readonly style?: string;
}

export interface PageMeta {
  readonly title: string;
  readonly description?: string;
}

export function lookOf<T extends LookInfo>(looks: readonly T[]): T {
  return looks.reduce<T>(
    (all, look) => ({
      ...all,
      ...look,
      fonts: { ...all.fonts, ...look.fonts },
      colors: { light: { ...all.colors?.light, ...look.colors?.light }, dark: { ...all.colors?.dark, ...look.colors?.dark } },
      references: [...new Set([...(all.references ?? []), ...(look.references ?? [])])],
      style: [all.style, look.style].filter(Boolean).join("\n"),
    }),
    {} as T,
  );
}

export function homeOf(pages: readonly PageInfo[]): string | null {
  const open = pages.filter((page) => isPage({ method: "GET", path: page.path }));
  return (open.find((page) => page.nav) ?? open[0])?.path ?? null;
}

export function pageTitle(title: string, look: LookInfo): string {
  return look.brand && title !== look.brand ? `${title} · ${look.brand}` : title;
}

function meta(title: string, description: string | undefined): PageMeta {
  return description ? { title, description } : { title };
}

function home(pages: readonly PageInfo[], look: LookInfo): PageMeta | null {
  const own = pages.find((page) => page.path === "/");
  if (own) return meta(pageTitle(own.title, look), own.description ?? look.description);
  const first = pages.find((page) => page.path === homeOf(pages));
  if (!first) return null;
  return meta(look.brand ?? first.title, look.description ?? first.description);
}

export function staticPages(pages: readonly PageInfo[], look: LookInfo, served: readonly string[] = []): Map<string, PageMeta> {
  const found = new Map<string, PageMeta>();
  const free = (path: string) => !served.some((route) => matchPath(route, path));
  const root = home(pages, look);
  if (root && free("/")) found.set("/", root);
  for (const page of pages) {
    const path = page.path.replace(/\/+$/, "");
    if (!isPage({ method: "GET", path }) || !/^[A-Za-z0-9\-._~/]+$/.test(path) || found.has(path) || !free(path)) continue;
    found.set(path, meta(pageTitle(page.title, look), page.description ?? look.description));
  }
  return found;
}
