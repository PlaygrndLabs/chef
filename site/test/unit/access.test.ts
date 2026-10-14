import { describe, expect, it } from "vitest";
import { engineRule } from "../../src/access.ts";

const rule = (method: string, path: string) => engineRule(method, new URL(`https://chef.example.com${path}`));

describe("engine access rules", () => {
  it("lets viewers read, editors build and managers change a project's settings", () => {
    expect(rule("GET", "/api/projects")).toEqual({ kind: "list" });
    expect(rule("POST", "/api/projects")).toEqual({ kind: "create" });
    expect(rule("GET", "/api/projects/shop/events")).toEqual({ kind: "project", project: "shop", need: "view" });
    expect(rule("GET", "/agents/project/shop")).toEqual({ kind: "project", project: "shop", need: "view" });
    expect(rule("GET", "/agents/project/shop?voice=1")).toEqual({ kind: "project", project: "shop", need: "edit" });
    expect(rule("GET", "/preview/shop/cart/")).toEqual({ kind: "project", project: "shop", need: "view" });
    expect(rule("POST", "/api/projects/shop/prompts")).toEqual({ kind: "project", project: "shop", need: "edit" });
    expect(rule("POST", "/api/projects/shop/git/sync")).toEqual({ kind: "project", project: "shop", need: "edit" });
    expect(rule("POST", "/api/projects/shop/features/settings")).toEqual({ kind: "project", project: "shop", need: "edit" });
    expect(rule("POST", "/api/projects/shop/copilotkit/info")).toEqual({ kind: "project", project: "shop", need: "edit" });
    for (const path of ["settings", "env", "instructions", "memory", "agents", "agents/restore"]) expect(rule("PUT", `/api/projects/shop/${path}`)).toEqual({ kind: "project", project: "shop", need: "manage" });
  });

  it("keeps settings for the whole organization to owners and admins", () => {
    expect(rule("GET", "/api/settings")).toEqual({ kind: "open" });
    expect(rule("PUT", "/api/settings")).toEqual({ kind: "admin" });
    expect(rule("PUT", "/api/env")).toEqual({ kind: "admin" });
    expect(rule("POST", "/api/github/app")).toEqual({ kind: "admin" });
    expect(rule("GET", "/agents/session-agent/x")).toEqual({ kind: "admin" });
  });
});
