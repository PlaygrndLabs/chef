export interface AppPage {
  readonly title: string;
  readonly path: string;
}

export interface FrameReport {
  readonly path: string;
  readonly title: string;
  readonly pages: readonly AppPage[];
}

export interface Trail {
  readonly entries: readonly string[];
  readonly index: number;
}

export function isPagePath(path: string): boolean {
  if (path === "/" || path.includes(":") || path === "/api" || path.startsWith("/api/")) return false;
  return !/\.[A-Za-z0-9]+$/.test(path.split("/").pop() ?? "");
}

export function entryPage(entrypoint: string | undefined): string | null {
  const match = /^\s*(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(\/\S*)/i.exec(entrypoint ?? "");
  const method = (match?.[1] ?? "GET").toUpperCase();
  const path = match?.[2];
  return path && method === "GET" && isPagePath(path) ? path : null;
}

export function frameReport(data: unknown): FrameReport | null {
  if (!data || typeof data !== "object") return null;
  const { chef, path, title, pages } = data as Record<string, unknown>;
  if (chef !== "page" || typeof path !== "string" || !path.startsWith("/") || !Array.isArray(pages)) return null;
  const valid = pages.filter((p): p is AppPage => Boolean(p) && typeof p.path === "string" && p.path.startsWith("/") && typeof p.title === "string");
  return { path, title: typeof title === "string" ? title : "", pages: valid };
}

export function addressPath(input: string): string {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return `${url.pathname}${url.search}`;
    } catch {
      return "/";
    }
  }
  const path = text.replace(/^\/+/, "");
  return `/${path}`;
}

export function visit(trail: Trail, path: string): Trail {
  if (trail.entries[trail.index] === path) return trail;
  const entries = [...trail.entries.slice(0, trail.index + 1), path];
  return { entries, index: entries.length - 1 };
}

export function step(trail: Trail, delta: number): Trail {
  const index = Math.min(trail.entries.length - 1, Math.max(0, trail.index + delta));
  return index === trail.index ? trail : { entries: trail.entries, index };
}

export function pageChips(pages: readonly AppPage[], start: string): AppPage[] {
  const chips: AppPage[] = [{ title: "Home", path: "/" }];
  for (const page of [...pages, { title: "", path: start }]) if (!chips.some((c) => c.path === page.path)) chips.push(page);
  return chips;
}
