import type { Store } from "./storage.ts";

export type Env = Readonly<Record<string, string | undefined>>;

export interface Context {
  readonly store: Store;
  readonly params: Readonly<Record<string, string>>;
  readonly env: Env;
}

export interface Route {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly handle: (request: Request, context: Context) => Promise<Response> | Response;
}

export interface Feature {
  readonly id: string;
  readonly title: string;
  readonly routes: readonly Route[];
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = pathname.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const part = a[i] as string;
    const value = b[i] as string;
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(value);
    else if (part !== value) return null;
  }
  return params;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function pagesOf(features: readonly Feature[]): { readonly title: string; readonly path: string }[] {
  return features.flatMap((feature) =>
    feature.routes.filter((route) => route.method === "GET" && route.path !== "/" && !route.path.includes(":") && !route.path.startsWith("/api/") && route.path !== "/api").map((route) => ({ title: feature.title, path: route.path })),
  );
}

export function indexPage(features: readonly Feature[]): Response {
  const pages = pagesOf(features);
  const items = pages.map((page) => `<li><a href="${escapeHtml(page.path)}">${escapeHtml(page.title)}</a> <code>${escapeHtml(page.path)}</code></li>`).join("");
  const body = pages.length ? `<ul>${items}</ul>` : "<p>No pages yet. Pages show up here as features add them.</p>";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>App</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#111}li{margin:.4rem 0}code{color:#666;font-size:.85em}</style></head><body><h1>App</h1>${body}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function wantsPage(request: Request): boolean {
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
}

export function createApp(features: readonly Feature[], store: Store, env: Env = {}): (request: Request) => Promise<Response> {
  const routes = features.flatMap((feature) => feature.routes);
  const rootPage = features.some((feature) => feature.id !== "home" && feature.routes.some((route) => route.method === "GET" && route.path === "/"));
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/" && !rootPage && wantsPage(request)) return indexPage(features);
    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (params) return route.handle(request, { store, params, env });
    }
    return json({ error: "not found" }, 404);
  };
}
