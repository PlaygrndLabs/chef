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

export function lanePartPath(id: string, role: string): string {
  return `features/${id}/${role}/routes.ts`;
}

export function renderLaneIndex(id: string, title: string, roles: readonly string[]): string {
  const name = (role: string) => `${identifier(role)}Routes`;
  return [
    `import type { Feature } from "../../shared/http.ts";`,
    ...roles.map((role) => `import { routes as ${name(role)} } from "./${role}/routes.ts";`),
    "",
    `export const feature: Feature = { id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)}, routes: [${roles.map((role) => `...${name(role)}`).join(", ")}] };`,
    "",
  ].join("\n");
}

export function renderLanePart(): string {
  return [`import type { Route } from "../../../shared/http.ts";`, "", "export const routes: readonly Route[] = [];", ""].join("\n");
}

const LANE_INDEX = /^import type \{ Feature \} from "\.\.\/\.\.\/shared\/http\.ts";\n((?:import \{ routes as \w+ \} from "\.\/[a-z0-9-]+\/routes\.ts";\n)+)\nexport const feature: Feature = \{ id: .*, routes: \[[^\]]*\] \};\n?$/;

export function laneRoles(index: string): string[] | null {
  const imports = LANE_INDEX.exec(index)?.[1];
  return imports ? [...imports.matchAll(/from "\.\/([a-z0-9-]+)\/routes\.ts"/g)].map((m) => m[1] as string) : null;
}

export function laneLayout(id: string, title: string, roles: readonly string[], files: Readonly<Record<string, string>>): { changes: Record<string, string>; parts: Record<string, string> } | null {
  const prefix = `features/${id}/`;
  const index = files[stubPath(id)];
  const laid = index === undefined ? [] : laneRoles(index);
  if (!laid) return null;
  if (index === undefined) for (const path of Object.keys(files)) if (path.startsWith(prefix) && !path.endsWith(".test.ts") && path !== `${prefix}flow.ts`) return null;
  const all = [...laid, ...roles.filter((role) => !laid.includes(role))];
  const parts = Object.fromEntries(roles.map((role) => [role, lanePartPath(id, role)]));
  const changes: Record<string, string> = {};
  if (all.length > laid.length) changes[stubPath(id)] = renderLaneIndex(id, title, all);
  for (const role of all) if (files[lanePartPath(id, role)] === undefined) changes[lanePartPath(id, role)] = renderLanePart();
  return { changes, parts };
}
