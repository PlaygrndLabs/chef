import type { Store } from "./storage.ts";
import type { PageMeta } from "./meta.ts";
import { bySpecificity, isApi, matchPath, shape } from "./paths.ts";
import { CSS } from "./theme.ts";

export { isPage, matchPath } from "./paths.ts";

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

export const CLIENT_PATH = "/client.js";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export function routeClashes(features: readonly Feature[]): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const feature of features) {
    for (const route of feature.routes) {
      const key = `${route.method} /${shape(route.path).join("/")}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, feature.id);
      else clashes.push(first === feature.id ? `${route.method} ${route.path} is served twice by ${feature.id}` : `${route.method} ${route.path} is served by both ${first} and ${feature.id}`);
    }
  }
  return clashes;
}

const ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c);
}

export function shellHtml(meta: PageMeta = { title: "App" }): string {
  const title = escape(meta.title);
  const description = meta.description ? escape(meta.description) : "";
  const tags = [
    `<title>${title}</title>`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:type" content="website">`,
    `<meta name="twitter:card" content="summary">`,
    ...(description ? [`<meta name="description" content="${description}">`, `<meta property="og:description" content="${description}">`] : []),
  ].join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${tags}<style>${CSS}</style></head><body><div id="root"></div><script type="module" src="${CLIENT_PATH}"></script></body></html>`;
}

export function shell(): Response {
  return new Response(shellHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function failure(request: Request, path: string, error: unknown): Response {
  const reason = (error instanceof Error ? error.message : String(error ?? "")).trim() || "an unknown error";
  return json({ error: `The server failed while answering ${request.method} ${path}: ${reason}` }, 500);
}

function wantsPage(request: Request): boolean {
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
}

export function createApp(features: readonly Feature[], store: Store, env: Env = {}): (request: Request) => Promise<Response> {
  const clashes = routeClashes(features);
  if (clashes.length) throw new Error(`routes clash: ${clashes.join("; ")}. Give each route its own method and path`);
  const routes = features.flatMap((feature) => feature.routes).sort(bySpecificity);
  return async (request) => {
    const url = new URL(request.url);
    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (!params) continue;
      try {
        return await route.handle(request, { store, params, env });
      } catch (error) {
        console.error(error);
        return failure(request, url.pathname, error);
      }
    }
    if (wantsPage(request) && !isApi(url.pathname)) return shell();
    if (url.pathname === "/" && request.method === "GET") return json({ ok: true });
    return json({ error: "not found" }, 404);
  };
}
