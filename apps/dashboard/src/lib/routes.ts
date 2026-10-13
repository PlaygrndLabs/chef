export interface Route {
  readonly method: string;
  readonly path: string;
}

const METHODS = "GET|POST|PUT|PATCH|DELETE";
const Q = "[\"'`]";
const PATH = `${Q}(\\/[^"'\`$]*)${Q}`;
const VALUE = `(?:${PATH}|([A-Za-z_][\\w]*))`;
const PATTERNS: readonly { readonly re: RegExp; readonly method: number; readonly path: number; readonly name?: number; readonly upper?: boolean }[] = [
  { re: new RegExp(`method:\\s*${Q}(${METHODS})${Q}[^{}]{0,200}?path:\\s*${VALUE}`, "g"), method: 1, path: 2, name: 3 },
  { re: new RegExp(`path:\\s*${VALUE}[^{}]{0,200}?method:\\s*${Q}(${METHODS})${Q}`, "g"), method: 3, path: 1, name: 2 },
  { re: new RegExp(`${Q}(${METHODS})${Q}\\s*,\\s*${VALUE}`, "g"), method: 1, path: 2, name: 3 },
  { re: new RegExp(`\\.(get|post|put|patch|delete)\\(\\s*${VALUE}`, "g"), method: 1, path: 2, name: 3, upper: true },
];
const CONSTANT = new RegExp(`(?:const|let)\\s+([A-Za-z_][\\w]*)\\s*(?::\\s*string\\s*)?=\\s*${PATH}`, "g");
const TEST = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$/;

export function routesIn(files: readonly { readonly path: string; readonly after: string | null }[]): Route[] {
  const seen = new Map<string, Route>();
  const sources = files.filter((file) => file.after && file.path.startsWith("features/") && !TEST.test(file.path)).map((file) => file.after as string);
  const constants = new Map<string, string>();
  for (const source of sources) for (const [, name, value] of source.matchAll(CONSTANT)) if (name && value) constants.set(name, value);
  for (const source of sources) {
    for (const pattern of PATTERNS) {
      for (const match of source.matchAll(pattern.re)) {
        const raw = match[pattern.method];
        const name = pattern.name ? match[pattern.name] : undefined;
        const path = match[pattern.path] ?? (name ? constants.get(name) : undefined);
        if (!raw || !path) continue;
        const method = pattern.upper ? raw.toUpperCase() : raw;
        seen.set(`${method} ${path}`, { method, path });
      }
    }
  }
  return [...seen.values()].sort((a, b) => Number(b.method === "GET") - Number(a.method === "GET") || a.path.localeCompare(b.path));
}

export function entryRoute(entrypoint: string | undefined): Route | null {
  const match = /^\s*(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(\/\S*)/i.exec(entrypoint ?? "");
  return match?.[2] ? { method: (match[1] ?? "GET").toUpperCase(), path: match[2] } : null;
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
