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

export type PreviewState =
  | { readonly status: "ready"; readonly url: string; readonly enter?: string }
  | { readonly status: "building"; readonly elapsedMs: number }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "missing" };

export function previewState(data: unknown): PreviewState | null {
  if (!data || typeof data !== "object") return null;
  const { status, url, elapsedMs, error, enter } = data as Record<string, unknown>;
  if (status === "ready" && typeof url === "string" && /^https?:\/\/[^/]/.test(url)) return typeof enter === "string" && enter.startsWith(`${new URL(url).origin}/`) ? { status, url, enter } : { status, url };
  if (status === "building") return { status, elapsedMs: typeof elapsedMs === "number" && elapsedMs > 0 ? elapsedMs : 0 };
  if (status === "failed") return { status, error: typeof error === "string" && error ? error : "The preview could not start." };
  if (status === "missing") return { status };
  return null;
}

export function enterAt(enter: string, path: string): string {
  const url = new URL(enter);
  url.searchParams.set("to", path || "/");
  return url.toString();
}

export function stateLink(link: string, retry: boolean): string {
  return `${link}${link.includes("?") ? "&" : "?"}state=1${retry ? "&retry=1" : ""}`;
}

export interface FrameLoad {
  readonly started: number;
  readonly checked: number | null;
  readonly building: { readonly since: number; readonly until: number | null } | null;
  readonly answered: number | null;
  readonly loaded: number | null;
  readonly error: string | null;
}

export type LoadStepState = "wait" | "run" | "done" | "failed";

export interface LoadStep {
  readonly label: string;
  readonly state: LoadStepState;
  readonly took: number | null;
}

export interface LoadView {
  readonly phase: "check" | "build" | "start" | "page" | "done" | "failed";
  readonly title: string;
  readonly detail: string;
  readonly steps: readonly LoadStep[];
  readonly percent: number;
  readonly slow: boolean;
}

export const WAKING_AFTER_MS = 1500;
const SLOW_AFTER_MS = 20_000;

const fill = (ms: number, typicalMs: number) => 1 - Math.exp(-Math.max(0, ms) / typicalMs);

interface Span {
  readonly label: string;
  readonly from: number | null;
  readonly to: number | null;
  readonly weight: number;
  readonly typicalMs: number;
}

export function loadView(load: FrameLoad, now: number, input: { readonly preview: boolean; readonly path: string }): LoadView {
  const { started, checked, building, answered, loaded, error } = load;
  const reachFrom = !input.preview ? started : building ? building.until : checked;
  const reachedAt = answered ?? loaded;
  const waking = reachFrom !== null && (reachedAt ?? now) - reachFrom >= WAKING_AFTER_MS;
  const spans: Span[] = [
    ...(input.preview ? [{ label: "Check the preview", from: started, to: checked, weight: 1, typicalMs: 800 }] : []),
    ...(building ? [{ label: "Build it again from the latest commit", from: building.since, to: building.until, weight: 12, typicalMs: 45_000 }] : []),
    { label: waking ? "Wake up the app" : "Reach the app", from: reachFrom, to: reachedAt, weight: 3, typicalMs: 2500 },
    { label: `Open ${input.path}`, from: answered, to: loaded, weight: 2, typicalMs: 1500 },
  ];
  let found = false;
  const steps = spans.map((span): LoadStep & { readonly span: Span } => {
    if (loaded !== null || span.to !== null) return { span, label: span.label, state: "done", took: span.from === null ? null : (span.to ?? loaded ?? now) - span.from };
    if (found || span.from === null) return { span, label: span.label, state: "wait", took: null };
    found = true;
    return { span, label: span.label, state: error ? "failed" : "run", took: now - span.from };
  });
  const total = spans.reduce((sum, span) => sum + span.weight, 0);
  const progress = steps.reduce((sum, step) => sum + (step.state === "done" ? step.span.weight : step.state === "run" ? step.span.weight * 0.92 * fill(step.took ?? 0, step.span.typicalMs) : 0), 0);
  const phase: LoadView["phase"] = loaded !== null ? "done" : error ? "failed" : building && building.until === null ? "build" : reachFrom === null ? "check" : answered === null ? "start" : "page";
  const current = steps.find((step) => step.state === "run");
  const slow = (phase === "start" || phase === "page") && (current?.took ?? 0) >= SLOW_AFTER_MS;
  const title = {
    check: "Checking the preview",
    build: "Waking up this preview",
    start: waking ? "Waking up the app" : "Opening the app",
    page: `Loading ${input.path}`,
    done: `Loaded ${input.path}`,
    failed: input.preview ? "This preview could not open" : "The app could not open",
  }[phase];
  const detail = {
    check: "Asking chef whether this preview is awake.",
    build: "It was asleep because nobody opened it for a while. chef is building it again from the latest commit of this feature. It opens here by itself when it is ready.",
    start: waking ? "Nobody opened it for a while, so Cloudflare is starting it again. The first visit after a pause takes longer." : "Sending the first request to the app.",
    page: "The app answered. Its page is loading.",
    done: "",
    failed: error ?? "",
  }[phase];
  return {
    phase,
    title,
    detail: slow ? `${detail} This is taking longer than usual.` : detail,
    steps: steps.map(({ label, state, took }) => ({ label, state, took })),
    percent: loaded !== null ? 100 : Math.min(99, Math.round((progress / total) * 100)),
    slow,
  };
}
