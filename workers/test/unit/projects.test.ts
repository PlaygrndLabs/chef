import { describe, expect, it } from "vitest";
import { projectsRequest, type ProjectEntry, type ProjectRegistry } from "../../src/projects.ts";

function registry(initial: ProjectEntry[] = []): ProjectRegistry & { list: ProjectEntry[] } {
  const list = [...initial];
  return {
    list,
    projects: async () => list,
    addProject: async (entry) => {
      if (list.some((p) => p.name === entry.name)) return false;
      list.push(entry);
      return true;
    },
  };
}

const post = (body: unknown) => new Request("https://chef.test/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("project list", () => {
  it("starts empty", async () => {
    const response = await projectsRequest(new Request("https://chef.test/api/projects"), registry(), async () => Response.json({}));
    expect(await response.json()).toEqual({ projects: [] });
  });

  it("creates the project from the template and lists it", async () => {
    const calls: string[] = [];
    const projects = registry();
    const response = await projectsRequest(post({ name: "shop" }), projects, async (project, path, init) => {
      calls.push(`${init.method} ${project}/${path}`);
      return Response.json({ commitId: "c1", created: true });
    }, () => 42);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ name: "shop", commitId: "c1", created: true });
    expect(calls).toEqual(["POST shop/bootstrap"]);
    expect(projects.list).toEqual([{ name: "shop", createdAt: 42 }]);
  });

  it("links the repository before importing it", async () => {
    const calls: string[] = [];
    const git = { url: "https://github.com/me/app", branch: "main", mode: "off", syncBranch: "chef" };
    const response = await projectsRequest(post({ name: "app", git }), registry(), async (project, path, init) => {
      calls.push(`${init.method} ${project}/${path} ${String(init.body ?? "")}`);
      return path === "settings" ? Response.json({}) : Response.json({ commitId: "c2", created: true, imported: true });
    });
    expect(response.status).toBe(201);
    expect(calls).toEqual([`PUT app/settings ${JSON.stringify({ git })}`, "POST app/bootstrap "]);
  });

  it("rejects bad names and duplicates and keeps failed projects off the list", async () => {
    const projects = registry([{ name: "shop", createdAt: 1 }]);
    const ok = async () => Response.json({ commitId: "c", created: true });
    expect((await projectsRequest(post({ name: "Shop!" }), projects, ok)).status).toBe(400);
    expect((await projectsRequest(post({ name: "shop" }), projects, ok)).status).toBe(409);
    const failed = await projectsRequest(post({ name: "broken" }), projects, async () => Response.json({ error: "importing the linked repository did not finish: failed" }, { status: 409 }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toEqual({ error: "importing the linked repository did not finish: failed" });
    expect(projects.list.map((p) => p.name)).toEqual(["shop"]);
  });
});
