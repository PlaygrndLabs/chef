import { describe, expect, it } from "vitest";
import { previewName } from "@chef/core";
import { lostCreateRace, parsePreview } from "../../src/sandbox-checks.ts";
import { cloudflareAllowed } from "../../src/sandbox-grants.ts";
import { previewPath, previewResponse } from "@chef/adapters/preview-page";

const grant = { accountId: "acc1", worker: "chef-project-demo" };
const api = (path: string) => new URL(`https://api.cloudflare.com/client/v4/accounts/acc1${path}`);

describe("sandbox previews", () => {
  it("names a preview after its feature branch", () => {
    expect(previewName("preview/add-todo-item")).toBe("add-todo-item");
    expect(previewName("preview/Add_Todo--s1")).toBe("add-todo-s1");
    expect(previewName("preview/a-very-long-feature-name-that-goes-on-and-on")).toBe("a-very-long-feature-name-that");
    expect(previewName("preview/a-very-long-feature-name-that-goes-on-and-on", "a-project-name-that-is-31-chars")).toBe("a-very-long-feature-name-that");
    expect(previewName("preview/a-very-long-feature-name-that-goes-on-and-on", "trial-a-project-name-that-is-31-chars")).toBe("a-very-long-feature-name");
  });

  it("reads the Preview URL and deployment from wrangler preview --json", () => {
    const stdout = `noise\n${JSON.stringify({ preview: { name: "add-todo-item", urls: ["https://add-todo-item-chef-project-demo.acme.workers.dev"] }, deployment: { id: "dep1", urls: ["https://dep1-chef-project-demo.acme.workers.dev"] } }, null, 2)}\n`;
    expect(parsePreview(stdout, "c1")).toEqual({ url: "https://add-todo-item-chef-project-demo.acme.workers.dev", versionId: "dep1", commitId: "c1" });
    expect(() => parsePreview("Error: not authorized", "c1")).toThrow(/no JSON/);
    expect(() => parsePreview(JSON.stringify({ preview: {}, deployment: {} }), "c1")).toThrow(/no URL/);
  });

  it("spots a preview that lost the race to create the project Worker", () => {
    expect(lostCreateRace("✘ [ERROR] A request to the Cloudflare API (/accounts/a/workers/workers) failed.\n\n  A Worker with the name 'chef-project-todo5' already exists. Choose a different name. [code: 10040]")).toBe(true);
    expect(lostCreateRace("✘ [ERROR] Authentication error [code: 10000]")).toBe(false);
  });

  it("lends the Cloudflare token only to the project Worker's API paths", () => {
    expect(cloudflareAllowed(api("/workers/workers"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/subdomain"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/workers/chef-project-demo/previews/add-todo-item/deployments"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/scripts/chef-project-demo/subdomain"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/services/chef-project-demo"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/services/chef"), grant)).toBe(false);
    expect(cloudflareAllowed(api("/workers/scripts/chef"), grant)).toBe(false);
    expect(cloudflareAllowed(api("/workers/workers/chef-project-demo-evil"), grant)).toBe(false);
    expect(cloudflareAllowed(api("/r2/buckets"), grant)).toBe(false);
    expect(cloudflareAllowed(new URL("https://api.cloudflare.com/client/v4/accounts/other/workers/workers"), grant)).toBe(false);
    expect(cloudflareAllowed(new URL("https://evil.example/client/v4/accounts/acc1/workers/workers"), grant)).toBe(false);
  });
});

describe("preview paths", () => {
  it("keeps a page path and refuses anything that leaves the preview", () => {
    expect(previewPath("/notes")).toBe("/notes");
    expect(previewPath("/api/notes?x=1")).toBe("/api/notes?x=1");
    expect(previewPath(null)).toBe("");
    expect(previewPath("notes")).toBe("");
    expect(previewPath("//evil.example")).toBe("");
    expect(previewPath("/\\evil.example")).toBe("");
  });

  it("tells the dashboard the preview's state, or sends a browser on to the preview", async () => {
    const ready = { status: "ready" as const, url: "https://add-todo.example.workers.dev/", commitId: "c1" };
    const go = previewResponse(ready, { key: "add-todo", path: "/todos", asState: false, now: 0 });
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe("https://add-todo.example.workers.dev/todos");
    const entered = previewResponse(ready, { key: "add-todo", path: "/todos", asState: false, now: 0, enter: "https://add-todo.example.workers.dev/__chef/enter?t=x&to=%2Ftodos" });
    expect(entered.headers.get("location")).toBe("https://add-todo.example.workers.dev/__chef/enter?t=x&to=%2Ftodos");
    expect(entered.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await previewResponse(ready, { key: "add-todo", path: "/todos", asState: true, now: 0 }).json()).toEqual(ready);
    const building = { status: "building" as const, since: 1000 };
    expect(await previewResponse(building, { key: "add-todo", path: "", asState: true, now: 5000 }).json()).toEqual({ status: "building", since: 1000, elapsedMs: 4000 });
    expect(await previewResponse(building, { key: "add-todo", path: "", asState: false, now: 5000 }).text()).toMatch(/Waking up this preview/);
    const failed = previewResponse({ status: "failed", error: "deploy <broke>" }, { key: "add-todo", path: "", asState: false, now: 0 });
    expect(await failed.text()).toMatch(/deploy &lt;broke&gt;/);
    expect(previewResponse({ status: "missing" }, { key: "add-todo", path: "", asState: false, now: 0 }).status).toBe(404);
  });
});
