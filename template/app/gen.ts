export const REGISTRY_PATH = "src/registry.gen.ts";

function identifier(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function featureIds(paths: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const path of paths) {
    const match = /^features\/([a-z][a-z0-9-]*)\/index\.ts$/.exec(path);
    if (match) ids.add(match[1] as string);
  }
  return [...ids].sort();
}

export function renderRegistry(paths: Iterable<string>): string {
  const ids = featureIds(paths);
  const imports = ids.map((id) => `import { feature as ${identifier(id)} } from "../features/${id}/index.ts";`);
  return [...imports, `import type { Feature } from "../shared/http.ts";`, "", `export const features: readonly Feature[] = [${ids.map(identifier).join(", ")}];`, ""].join("\n");
}

export function renderStub(id: string, title: string): string {
  return [`import type { Feature } from "../../shared/http.ts";`, "", `export const feature: Feature = { id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)}, routes: [] };`, ""].join("\n");
}

export function stubPath(id: string): string {
  return `features/${id}/index.ts`;
}
