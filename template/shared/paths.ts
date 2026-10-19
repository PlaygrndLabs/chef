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

export function isApi(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

export function shape(path: string): string[] {
  return path.split("/").filter(Boolean).map((part) => (part.startsWith(":") ? ":" : part));
}

export function bySpecificity(a: { readonly path: string }, b: { readonly path: string }): number {
  const x = shape(a.path);
  const y = shape(b.path);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const left = x[i] === ":";
    const right = y[i] === ":";
    if (left !== right) return left ? 1 : -1;
  }
  return 0;
}

export function isPage(route: { readonly method: string; readonly path: string }): boolean {
  const { method, path } = route;
  if (method !== "GET" || path === "/" || path.includes(":") || isApi(path)) return false;
  return !/\.[A-Za-z0-9]+$/.test(path.split("/").pop() ?? "");
}
