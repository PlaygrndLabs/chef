import { html, icon, page } from "./ui.ts";
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

export function isPage(route: Pick<Route, "method" | "path">): boolean {
  const { method, path } = route;
  if (method !== "GET" || path === "/" || path.includes(":") || path === "/api" || path.startsWith("/api/")) return false;
  return !/\.[A-Za-z0-9]+$/.test(path.split("/").pop() ?? "");
}

export function pagesOf(features: readonly Feature[]): { readonly title: string; readonly path: string }[] {
  return features.flatMap((feature) => feature.routes.filter(isPage).map((route) => ({ title: feature.title, path: route.path })));
}

export function indexPage(features: readonly Feature[]): Response {
  const pages = pagesOf(features);
  const body = pages.length
    ? html`<ul class="list">${pages.map((p) => html`<li><a class="row grow" href="${p.path}" style="text-decoration:none">${icon("file")}<span class="grow strong">${p.title}</span><code>${p.path}</code>${icon("chevron-right", { class: "muted" })}</a></li>`)}</ul>`
    : html`<div class="empty">${icon("sparkles")}<strong>No pages yet</strong><span>Pages show up here as features add them.</span></div>`;
  return page({ title: "App", body: html`<header class="page-header"><div><h1>App</h1><p>Every page in this app.</p></div></header>${body}` });
}

function wantsPage(request: Request): boolean {
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
}

export function createApp(features: readonly Feature[], store: Store, env: Env = {}): (request: Request) => Promise<Response> {
  const routes = features.flatMap((feature) => feature.routes);
  const rootPage = routes.some((route) => route.method === "GET" && route.path === "/");
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/" && !rootPage && request.method === "GET") return wantsPage(request) ? indexPage(features) : json({ ok: true, pages: pagesOf(features).map((page) => page.path) });
    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (params) return route.handle(request, { store, params, env });
    }
    return json({ error: "not found" }, 404);
  };
}
