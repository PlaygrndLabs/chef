import { describe, expect, it } from "vitest";
import { buildingPage } from "@chef/adapters/preview-page";
import { CloudflareWorkerSpace } from "../../src/preview-space.ts";

describe("preview Worker space", () => {
  it("deletes the project Worker and treats a missing one as deleted", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const status = [200, 404, 500];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", auth: new Headers(init.headers).get("authorization") });
      return new Response("nope", { status: status.shift() ?? 500 });
    }) as unknown as typeof fetch;
    const space = new CloudflareWorkerSpace({ accountId: "acc1", worker: "chef-project-demo" }, "tok", fetcher);
    await space.remove();
    await space.remove();
    await expect(space.remove()).rejects.toThrow(/500/);
    expect(calls[0]).toEqual({ url: "https://api.cloudflare.com/client/v4/accounts/acc1/workers/scripts/chef-project-demo?force=true", method: "DELETE", auth: "Bearer tok" });
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
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.cloudflare.com/client/v4/accounts/acc1", "")}`)).toEqual(["GET /workers/workers/chef-project-demo", "POST /workers/workers", "PATCH /workers/workers/chef-project-demo"]);
    expect(calls[1]?.body).toEqual({ name: "chef-project-demo", subdomain: { enabled: true, previews_enabled: true } });
    expect(calls[2]?.type).toBe("application/merge-patch+json");

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
