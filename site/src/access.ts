import type { ProjectLevel } from "./orgs.ts";

export type EngineRule =
  | { readonly kind: "list" }
  | { readonly kind: "create" }
  | { readonly kind: "project"; readonly project: string; readonly need: ProjectLevel }
  | { readonly kind: "admin" }
  | { readonly kind: "open" };

const PROJECT_PATH = /^\/(?:api\/projects|agents\/project|preview)\/([a-z][a-z0-9-]{1,30})(?:\/(.*))?$/;
const MANAGE = new Set(["settings", "env", "budget", "instructions", "memory", "agents", "restore", "git"]);

function projectNeed(method: string, url: URL, rest: string): ProjectLevel {
  if (url.pathname.startsWith("/agents/project/") && url.searchParams.has("voice")) return "edit";
  if (method === "GET" || method === "HEAD") return "view";
  if (rest.startsWith("sessions/") || rest.startsWith("features/")) return "edit";
  return MANAGE.has(rest.split("/").filter(Boolean).at(-1) ?? "") ? "manage" : "edit";
}

export function engineRule(method: string, url: URL): EngineRule {
  const read = method === "GET" || method === "HEAD";
  if (url.pathname === "/api/projects") return read ? { kind: "list" } : { kind: "create" };
  const project = PROJECT_PATH.exec(url.pathname);
  if (project) return { kind: "project", project: project[1] as string, need: projectNeed(method, url, project[2] ?? "") };
  if (url.pathname.startsWith("/agents/")) return { kind: "admin" };
  return read ? { kind: "open" } : { kind: "admin" };
}
