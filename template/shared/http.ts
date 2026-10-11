import type { Store } from "./storage.ts";

export interface Context {
  readonly store: Store;
  readonly params: Readonly<Record<string, string>>;
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

export function createApp(features: readonly Feature[], store: Store): (request: Request) => Promise<Response> {
  const routes = features.flatMap((feature) => feature.routes);
  return async (request) => {
    const url = new URL(request.url);
    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (params) return route.handle(request, { store, params });
    }
    return json({ error: "not found" }, 404);
  };
}
