import { describe, expect, it } from "vitest";
import { appPage, appPath, appResponse } from "@chef/adapters/app-page";
import { AppRouter, appName, routerName, RouterTakenError } from "../../src/app-router.ts";

type Call = { method: string; path: string; body: unknown };

function cloudflare(replies: Response[]) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = init.body instanceof FormData ? JSON.parse(String(init.body.get("metadata"))) : init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init.method ?? "GET", path: url.replace("https://api.cloudflare.com/client/v4/accounts/acc1", ""), body });
    return replies.shift() ?? new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe("app addresses", () => {
  it("names the router after the engine and keeps each address inside a workers.dev label", () => {
    expect(routerName("chef-dev")).toBe("chef-dev-app");
    expect(appName("s1a2b3c4-shop", "chef-dev-app")).toBe("s1a2b3c4-shop");
    expect(appName("main-Visual_Thinker", "chef-dev-app")).toBe("main-visual-thinker");
    expect(appName("s1a2b3c4-a-project-name-that-is-31-chars", "chef-playgrndlabs-k8vj-app")).toBe("s1a2b3c4-a-project-name-that-is-31-c");
  });

  it("gives a branch an address on the router that forwards to its sandbox, with the app key as a secret", async () => {
    const { calls, fetcher } = cloudflare([
      new Response("{}", { status: 404 }),
      Response.json({ success: true, result: { name: "chef-dev-app" } }),
      new Response("{}", { status: 404 }),
      Response.json({ success: true, result: { id: "p1", name: "s1-shop", urls: ["https://s1-shop-chef-dev-app.acme.workers.dev"] } }),
      Response.json({ success: true, result: { id: "d1" } }),
    ]);
    const router = new AppRouter({ accountId: "acc1", apiToken: "tok" }, "chef-dev-app", "chef-dev", fetcher);
    expect(await router.address({ label: "s1-shop", target: "s1", key: "k".repeat(43) })).toBe("https://s1-shop-chef-dev-app.acme.workers.dev");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /workers/workers/chef-dev-app", "POST /workers/workers", "GET /workers/workers/chef-dev-app/previews/s1-shop", "POST /workers/workers/chef-dev-app/previews", "POST /workers/workers/chef-dev-app/previews/s1-shop/deployments"]);
    expect(calls[1]?.body).toEqual({ name: "chef-dev-app", tags: ["chef-router"], subdomain: { enabled: true, previews_enabled: true } });
    expect(calls[4]?.body).toMatchObject({
      main_module: "router.mjs",
      env: { SESSION: { type: "durable_object_namespace", class_name: "SessionAgent", script_name: "chef-dev" }, CHEF_TARGET: { type: "plain_text", text: "s1" }, CHEF_APP_KEY: { type: "secret_text", text: "k".repeat(43) } },
    });
  });

  it("uses the address another start of the same app just made", async () => {
    const { calls, fetcher } = cloudflare([
      Response.json({ success: true, result: { name: "chef-dev-app", tags: ["chef-router"] } }),
      new Response("{}", { status: 404 }),
      Response.json({ success: false, errors: [{ code: 100338, message: "A preview with name 'main-shop' already exists." }] }, { status: 409 }),
      Response.json({ success: true, result: { id: "p1", name: "main-shop", urls: ["https://main-shop-chef-dev-app.acme.workers.dev"] } }),
      Response.json({ success: true, result: { id: "d1" } }),
    ]);
    const router = new AppRouter({ accountId: "acc1", apiToken: "tok" }, "chef-dev-app", "chef-dev", fetcher);
    expect(await router.address({ label: "main-shop", target: "shop--main", key: "k" })).toBe("https://main-shop-chef-dev-app.acme.workers.dev");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /workers/workers/chef-dev-app", "GET /workers/workers/chef-dev-app/previews/main-shop", "POST /workers/workers/chef-dev-app/previews", "GET /workers/workers/chef-dev-app/previews/main-shop", "POST /workers/workers/chef-dev-app/previews/main-shop/deployments"]);
  });

  it("refuses a router name Chef did not make, and forgets addresses that are already gone", async () => {
    const taken = cloudflare([Response.json({ success: true, result: { tags: [] } })]);
    await expect(new AppRouter({ accountId: "acc1", apiToken: "tok" }, "chef-dev-app", "chef-dev", taken.fetcher).address({ label: "main-shop", target: "shop--main", key: "k" })).rejects.toBeInstanceOf(RouterTakenError);
    const gone = cloudflare([new Response("{}", { status: 404 }), Response.json({ success: true, result: {} })]);
    await new AppRouter({ accountId: "acc1", apiToken: "tok" }, "chef-dev-app", "chef-dev", gone.fetcher).remove(["main-shop", "s1-shop"]);
    expect(gone.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /workers/workers/chef-dev-app/previews/main-shop", "DELETE /workers/workers/chef-dev-app/previews/s1-shop"]);
  });
});

describe("app pages", () => {
  it("keeps a page path and refuses anything that leaves the app", () => {
    expect(appPath("/notes")).toBe("/notes");
    expect(appPath("/api/notes?x=1")).toBe("/api/notes?x=1");
    expect(appPath(null)).toBe("");
    expect(appPath("notes")).toBe("");
    expect(appPath("//evil.example")).toBe("");
    expect(appPath("/\\evil.example")).toBe("");
  });

  it("tells the dashboard the app's state, or sends a browser on to the app", async () => {
    const ready = { status: "ready" as const, url: "https://s1-shop.example.workers.dev/", commitId: "c1" };
    const go = appResponse(ready, { target: "s1", path: "/todos", asState: false, now: 0 });
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe("https://s1-shop.example.workers.dev/todos");
    expect(await appResponse(ready, { target: "s1", path: "", asState: true, now: 0, enter: "https://s1-shop.example.workers.dev/__chef/enter?t=x" }).json()).toEqual({ ...ready, enter: "https://s1-shop.example.workers.dev/__chef/enter?t=x" });
    expect(await appResponse({ status: "starting", since: 1000 }, { target: "s1", path: "", asState: true, now: 4000 }).json()).toEqual({ status: "starting", since: 1000, elapsedMs: 3000 });
    const starting = await appResponse({ status: "starting", since: 1000 }, { target: "main", path: "/todos", asState: false, now: 4000 }).text();
    expect(starting).toContain('data-since="1000" data-poll="state"');
    expect(starting).toContain("Start the app from the latest commit");
    expect(starting).toContain("Open /todos");
    expect(starting).not.toContain('<meta http-equiv="refresh" content="4"><title>');
    const failed = await appResponse({ status: "failed", error: "port <8080> busy" }, { target: "s1", path: "", asState: false, now: 0 }).text();
    expect(failed).toContain("port &lt;8080&gt; busy");
    expect(await appPage({ status: "no-stack", target: "main" }).text()).toContain("compose file");
    expect(appPage({ status: "missing", target: "s9" }).status).toBe(404);
  });

  it("answers an app's own API calls with JSON while the app is not ready", async () => {
    const starting = appPage({ status: "starting", target: "s1", html: false });
    expect(starting.status).toBe(503);
    expect(await starting.json()).toEqual({ error: "Starting this app", status: "starting" });
    const down = appPage({ status: "down", target: "s1", html: false, error: "connection refused" });
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: "This app is not answering", status: "down", detail: "connection refused" });
    const downPage = await appPage({ status: "down", target: "s1", error: "connection refused" }).text();
    expect(downPage).toContain("connection refused");
    expect(downPage).toContain('<meta http-equiv="refresh" content="6">');
  });
});
