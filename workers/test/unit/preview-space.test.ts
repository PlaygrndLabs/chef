import { describe, expect, it } from "vitest";
import { buildingPage } from "@chef/adapters/preview-page";
import { CloudflareWorkerSpace, WorkerTakenError } from "../../src/preview-space.ts";

describe("preview Worker space", () => {
  it("deletes only the feature previews, keeps the live Worker, and treats a missing preview as deleted", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const status = [200, 404, 500];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", auth: new Headers(init.headers).get("authorization") });
      return new Response("{}", { status: status.shift() ?? 500 });
    }) as unknown as typeof fetch;
    const space = new CloudflareWorkerSpace({ accountId: "acc1", worker: "demo" }, "tok", fetcher);
    await space.remove(["preview/todo-add", "preview/Old_One"]);
    await expect(space.remove(["preview/x"])).rejects.toThrow(/500/);
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.cloudflare.com/client/v4/accounts/acc1", "")}`)).toEqual(["DELETE /workers/workers/demo/previews/todo-add", "DELETE /workers/workers/demo/previews/old-one", "DELETE /workers/workers/demo/previews/x"]);
    expect(calls[0]?.auth).toBe("Bearer tok");
  });

  it("claims the project's Worker name with a tag and refuses a Worker chef did not make", async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const replies: Response[] = [
      new Response("{}", { status: 404 }),
      Response.json({ success: false, errors: [{ code: 10040, message: "A Worker with the name 'demo' already exists" }] }, { status: 409 }),
      Response.json({ success: true, result: { tags: ["chef-project"] } }),
      Response.json({ success: true, result: { tags: [] } }),
    ];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? "GET", path: url.replace("https://api.cloudflare.com/client/v4/accounts/acc1", ""), body: init.body ? JSON.parse(String(init.body)) : null });
      return replies.shift() as Response;
    }) as unknown as typeof fetch;
    const space = new CloudflareWorkerSpace({ accountId: "acc1", worker: "demo" }, "tok", fetcher);
    await space.ensure();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /workers/workers/demo", "POST /workers/workers", "GET /workers/workers/demo"]);
    expect(calls[1]?.body).toEqual({ name: "demo", tags: ["chef-project"], subdomain: { enabled: true, previews_enabled: true } });
    await expect(space.ensure()).rejects.toBeInstanceOf(WorkerTakenError);
  });

  it("gives the live app the project's keys as secrets and drops removed ones", async () => {
    const calls: { method: string; path: string; type: string | null; body: unknown }[] = [];
    const replies: Response[] = [Response.json({ success: true, result: [{ name: "OLD_KEY", type: "secret_text" }, { name: "API_KEY", type: "secret_text" }] }), Response.json({ success: true, result: {} }), Response.json({ success: true, result: { subdomain: "acme" } })];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? "GET", path: url.replace("https://api.cloudflare.com/client/v4/accounts/acc1", ""), type: new Headers(init.headers).get("content-type"), body: init.body ? JSON.parse(String(init.body)) : null });
      return replies.shift() as Response;
    }) as unknown as typeof fetch;
    const space = new CloudflareWorkerSpace({ accountId: "acc1", worker: "demo" }, "tok", fetcher);
    await space.applyLiveEnvironment([
      { name: "API_KEY", secret: true, value: "sk_live_123" },
      { name: "API_URL", secret: false, value: "https://api.example.com" },
    ]);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /workers/scripts/demo/secrets", "PATCH /workers/scripts/demo/secrets-bulk"]);
    expect(calls[1]?.type).toBe("application/merge-patch+json");
    expect(calls[1]?.body).toEqual({ secrets: { OLD_KEY: null, API_KEY: { name: "API_KEY", text: "sk_live_123", type: "secret_text" }, API_URL: { name: "API_URL", text: "https://api.example.com", type: "secret_text" } } });
    expect(await space.liveUrl()).toBe("https://demo.acme.workers.dev");
  });

  it("shows a page that refreshes while the preview is rebuilt", async () => {
    const building = await buildingPage({ status: "building", key: "todo-add" }).text();
    expect(building).toContain('http-equiv="refresh"');
    const failed = buildingPage({ status: "failed", key: "todo-add", error: "<b>boom</b>" });
    const text = await failed.text();
    expect(text).toContain("&lt;b&gt;boom&lt;/b&gt;");
    expect(text).not.toContain("refresh");
    expect(buildingPage({ status: "missing", key: "x" }).status).toBe(404);
  });

  it("sets the project's keys on the previews' base config, creating the Worker first and dropping removed keys", async () => {
    const calls: { url: string; method: string; type: string | null; body: unknown }[] = [];
    const replies: Response[] = [
      new Response("{}", { status: 404 }),
      new Response("{}", { status: 404 }),
      Response.json({ success: true, result: {} }),
      Response.json({ success: true, result: {} }),
      Response.json({ success: true, result: { previews_base_config: { env: { OLD_KEY: { type: "secret_text" }, API_KEY: { type: "secret_text" } } } } }),
      Response.json({ success: true, result: {} }),
      Response.json({ success: false, errors: [{ message: "bad", text: "sk_live_123" }] }, { status: 400 }),
    ];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", type: new Headers(init.headers).get("content-type"), body: init.body ? JSON.parse(String(init.body)) : null });
      return replies.shift() as Response;
    }) as unknown as typeof fetch;
    const space = new CloudflareWorkerSpace({ accountId: "acc1", worker: "chef-project-demo" }, "tok", fetcher);
    const vars = [
      { name: "API_KEY", secret: true, value: "sk_live_123" },
      { name: "API_URL", secret: false, value: "https://api.example.com" },
    ];
    expect(await space.applyEnvironment(vars, { create: true })).toEqual({ API_KEY: { type: "secret_text", text: "sk_live_123" }, API_URL: { type: "plain_text", text: "https://api.example.com" } });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.cloudflare.com/client/v4/accounts/acc1", "")}`)).toEqual(["GET /workers/workers/chef-project-demo", "GET /workers/workers/chef-project-demo", "POST /workers/workers", "PATCH /workers/workers/chef-project-demo"]);
    expect(calls[2]?.body).toEqual({ name: "chef-project-demo", tags: ["chef-project"], subdomain: { enabled: true, previews_enabled: true } });
    expect(calls[3]?.type).toBe("application/merge-patch+json");

    const patch = await space.applyEnvironment(vars.slice(0, 1), { create: false });
    expect(patch).toEqual({ OLD_KEY: null, API_KEY: { type: "secret_text", text: "sk_live_123" } });
    expect(calls.at(-1)?.body).toEqual({ previews_base_config: { env: patch } });

    const error = await space.refreshPreview("todo-add", patch ?? {}).catch((e: unknown) => e as Error);
    expect(calls.at(-1)?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/workers/workers/chef-project-demo/previews/todo-add/deployments/latest");
    expect(String(error)).toContain("400");
    expect(String(error)).not.toContain("sk_live_123");
  });

  it("leaves a sleeping project alone when it is not asked to create the Worker", async () => {
    const fetcher = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const space = new CloudflareWorkerSpace({ accountId: "acc1", worker: "chef-project-demo" }, "tok", fetcher);
    expect(await space.applyEnvironment([{ name: "A", secret: true, value: "x" }], { create: false })).toBeNull();
  });
});
