export interface Route {
  readonly method: string;
  readonly path: string;
}

const METHOD_FIRST = /method:\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*path:\s*["'](\/[^"']*)["']/g;
const PATH_FIRST = /path:\s*["'](\/[^"']*)["']\s*,\s*method:\s*["'](GET|POST|PUT|PATCH|DELETE)["']/g;
const TEST = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$/;

export function routesIn(files: readonly { readonly path: string; readonly after: string | null }[]): Route[] {
  const seen = new Map<string, Route>();
  for (const file of files) {
    if (!file.after || !file.path.startsWith("features/") || TEST.test(file.path)) continue;
    for (const [, method, path] of file.after.matchAll(METHOD_FIRST)) if (method && path) seen.set(`${method} ${path}`, { method, path });
    for (const [, path, method] of file.after.matchAll(PATH_FIRST)) if (method && path) seen.set(`${method} ${path}`, { method, path });
  }
  return [...seen.values()].sort((a, b) => Number(b.method === "GET") - Number(a.method === "GET") || a.path.localeCompare(b.path));
}

export function isTestFile(path: string): boolean {
  return TEST.test(path);
}
