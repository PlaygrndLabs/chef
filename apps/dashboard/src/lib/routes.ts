export interface Route {
  readonly method: string;
  readonly path: string;
}

const METHODS = "GET|POST|PUT|PATCH|DELETE";
const PATTERNS: readonly { readonly re: RegExp; readonly method: number; readonly path: number; readonly upper?: boolean }[] = [
  { re: new RegExp(`method:\\s*["'](${METHODS})["'][^{}]{0,200}?path:\\s*["'](\\/[^"']*)["']`, "g"), method: 1, path: 2 },
  { re: new RegExp(`path:\\s*["'](\\/[^"']*)["'][^{}]{0,200}?method:\\s*["'](${METHODS})["']`, "g"), method: 2, path: 1 },
  { re: new RegExp(`["'](${METHODS})["']\\s*,\\s*["'](\\/[^"']*)["']`, "g"), method: 1, path: 2 },
  { re: /\.(get|post|put|patch|delete)\(\s*["'](\/[^"']*)["']/g, method: 1, path: 2, upper: true },
];
const TEST = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$/;

export function routesIn(files: readonly { readonly path: string; readonly after: string | null }[]): Route[] {
  const seen = new Map<string, Route>();
  for (const file of files) {
    if (!file.after || !file.path.startsWith("features/") || TEST.test(file.path)) continue;
    for (const pattern of PATTERNS) {
      for (const match of file.after.matchAll(pattern.re)) {
        const raw = match[pattern.method];
        const path = match[pattern.path];
        if (!raw || !path) continue;
        const method = pattern.upper ? raw.toUpperCase() : raw;
        seen.set(`${method} ${path}`, { method, path });
      }
    }
  }
  return [...seen.values()].sort((a, b) => Number(b.method === "GET") - Number(a.method === "GET") || a.path.localeCompare(b.path));
}

export function isTestFile(path: string): boolean {
  return TEST.test(path);
}

export function isPage(route: Route): boolean {
  return route.method === "GET" && route.path !== "/" && !route.path.includes(":") && route.path !== "/api" && !route.path.startsWith("/api/");
}

export function pagesFor(routes: readonly Route[], featureId: string | null): Route[] {
  const own = featureId ? `/${featureId}` : null;
  return routes.filter(isPage).sort((a, b) => Number(own !== null && b.path.startsWith(own)) - Number(own !== null && a.path.startsWith(own)) || a.path.length - b.path.length);
}
