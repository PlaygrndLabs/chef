import { describe, expect, it } from "vitest";
import { buildingPage, CloudflareWorkerSpace } from "../../src/preview-space.ts";

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
});
