import { describe, expect, it } from "vitest";
import { readSetupStream, SETUP_STREAM, SetupError, setupResponse, type SetupEvent } from "@chef/core";
import { projectsRequest, removeProjectRequest, type ProjectEntry, type ProjectRegistry } from "../../src/projects.ts";

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

describe("project setup progress", () => {
  const streamed = (body: unknown) => new Request("https://chef.test/api/projects", { method: "POST", headers: { "content-type": "application/json", accept: SETUP_STREAM }, body: JSON.stringify(body) });
  const events = async (response: Response) => {
    const out: SetupEvent[] = [];
    for await (const event of readSetupStream(response)) out.push(event);
    return out;
  };

  it("streams the steps and log of the project's own setup, then the result", async () => {
    const projects = registry();
    const git = { url: "https://github.com/me/app", branch: "main", mode: "pull-request", syncBranch: "chef" };
    const response = await projectsRequest(streamed({ name: "app", git }), projects, async (_project, path, init) => {
      if (path === "settings") return Response.json({});
      expect(new Headers(init.headers).get("accept")).toBe(SETUP_STREAM);
      return setupResponse(new Request("https://chef.internal/bootstrap", { method: "POST", headers: { accept: SETUP_STREAM } }), async (progress) => {
        progress.step("Copy the repository into Chef");
        progress.log("Copied main");
        return { commitId: "c3", created: true, imported: true };
      });
    }, () => 7);
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe(SETUP_STREAM);
    const seen = await events(response);
    expect(seen.map((e) => (e.type === "step" ? `step ${e.label}` : e.type === "log" ? `log ${e.text}` : e.type))).toEqual([
      "step Link the repository",
      "log Linked https://github.com/me/app (main); finished work goes to chef as pull requests",
      "step Copy the repository into Chef",
      "log Copied main",
      "log Added app to your projects",
      "done",
    ]);
    expect(seen.at(-1)).toEqual({ type: "done", at: 7, result: { name: "app", commitId: "c3", created: true, imported: true } });
    expect(projects.list).toEqual([{ name: "app", createdAt: 7 }]);
  });

  it("ends the stream with the error and keeps the project off the list", async () => {
    const projects = registry();
    const response = await projectsRequest(streamed({ name: "broken" }), projects, async () =>
      setupResponse(new Request("https://chef.internal/bootstrap", { headers: { accept: SETUP_STREAM } }), async (progress) => {
        progress.step("Create the project's git repository");
        throw new SetupError("importing the linked repository did not finish: empty", 409);
      }),
    );
    const seen = await events(response);
    expect(seen.at(-1)).toMatchObject({ type: "error", status: 409, error: "importing the linked repository did not finish: empty" });
    expect(projects.list).toEqual([]);
  });

  it("still relays a project that answers with plain JSON", async () => {
    const response = await projectsRequest(streamed({ name: "shop" }), registry(), async () => Response.json({ commitId: "c1", created: true }));
    expect((await events(response)).map((e) => e.type)).toEqual(["log", "done"]);
  });
});

describe("deleting a project", () => {
  const del = (name: string, body: unknown) => new Request(`https://chef.test/api/projects/${name}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const listed = () => {
    const projects = registry([{ name: "shop", createdAt: 1 }, { name: "blog", createdAt: 2 }]);
    return Object.assign(projects, {
      forgetProject: async (name: string) => {
        projects.list.splice(projects.list.findIndex((p) => p.name === name), 1);
      },
    });
  };

  it("asks for the name, removes the project's resources, then takes it off the list", async () => {
    const projects = listed();
    let removed = 0;
    const remove = async () => {
      removed++;
      return { removed: ["removed the app chef-shop"], kept: [] };
    };
    const unconfirmed = await removeProjectRequest(del("shop", { confirm: "shp" }), "shop", projects, remove);
    expect(unconfirmed.status).toBe(400);
    expect(removed).toBe(0);
    const response = await removeProjectRequest(del("shop", { confirm: "shop" }), "shop", projects, remove);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "shop", removed: ["removed the app chef-shop"], kept: [] });
    expect(projects.list.map((p) => p.name)).toEqual(["blog"]);
    expect((await removeProjectRequest(del("shop", { confirm: "shop" }), "shop", projects, remove)).status).toBe(404);
    expect(removed).toBe(1);
  });

  it("keeps the project listed when removing its resources fails, so deleting again can finish", async () => {
    const projects = listed();
    const response = await removeProjectRequest(del("shop", { confirm: "shop" }), "shop", projects, async () => {
      throw new Error("Cloudflare said no");
    });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain("Cloudflare said no");
    expect(projects.list.map((p) => p.name)).toEqual(["shop", "blog"]);
  });

  it("asks to try again when the project still runs the version before deleting existed", async () => {
    const projects = listed();
    const response = await removeProjectRequest(del("shop", { confirm: "shop" }), "shop", projects, async () => {
      throw new TypeError('The RPC receiver does not implement the method "removeProject".');
    });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toBe("Chef was just updated and shop is still finishing on the previous version. Nothing was deleted; try again in a minute.");
    expect(projects.list.map((p) => p.name)).toEqual(["shop", "blog"]);
  });
});
