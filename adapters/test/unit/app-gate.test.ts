import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { appEntry, newAppKey, routerModule, ROUTER_MODULE, signAppPass } from "../../src/app-gate.ts";

type Handler = { fetch(request: Request, env: Record<string, unknown>): Promise<Response> };

const ORIGIN = "https://s1a2b3c4-shop-chef-dev-app.example.workers.dev";
const KEY = newAppKey();
const html = { accept: "text/html" };

async function router(): Promise<Handler> {
  const dir = mkdtempSync(join(tmpdir(), "chef-router-"));
  writeFileSync(join(dir, ROUTER_MODULE), routerModule());
  return ((await import(pathToFileURL(join(dir, ROUTER_MODULE)).href)) as { default: Handler }).default;
}

function sandboxes(seen: { target?: string; request?: Request }) {
  return {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (request: Request) => {
        seen.target = id;
        seen.request = request;
        return Response.json({ path: new URL(request.url).pathname, cookie: request.headers.get("cookie"), app: request.headers.get("x-chef-app") });
      },
    }),
  };
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] as string;
}

describe("app router", () => {
  it("lets a fresh link from Chef in once, then forwards the visitor to the branch's sandbox", async () => {
    const app = await router();
    const seen: { target?: string; request?: Request } = {};
    const env = { CHEF_APP_KEY: KEY, CHEF_TARGET: "s1a2b3c4", SESSION: sandboxes(seen) };
    const entry = await appEntry(ORIGIN, KEY, { path: "/todos?x=1", now: Date.now() });
    expect(entry.startsWith(`${ORIGIN}/__chef/enter?t=`)).toBe(true);
    const entered = await app.fetch(new Request(entry), env);
    expect(entered.status).toBe(302);
    expect(entered.headers.get("location")).toBe("/todos?x=1");
    expect(entered.headers.get("set-cookie")).toMatch(/^__Host-chef_app=[^;]+; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=None; Partitioned$/);
    const page = await app.fetch(new Request(`${ORIGIN}/todos`, { headers: { cookie: `theme=dark; ${cookieOf(entered)}` } }), env);
    expect(await page.json()).toEqual({ path: "/todos", cookie: "theme=dark", app: "1" });
    expect(seen.target).toBe("s1a2b3c4");
  });

  it("turns away anyone without a valid way in", async () => {
    const app = await router();
    const seen: { target?: string } = {};
    const env = { CHEF_APP_KEY: KEY, CHEF_TARGET: "s1", SESSION: sandboxes(seen) };
    const now = Date.now();
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: html }), env)).status).toBe(401);
    expect(await (await app.fetch(new Request(`${ORIGIN}/api/todos`), env)).json()).toMatchObject({ error: expect.stringContaining("Apps Chef is building are private") });
    const expired = await signAppPass(KEY, { use: "enter", host: new URL(ORIGIN).hostname, expiresAt: now - 1 });
    expect((await app.fetch(new Request(`${ORIGIN}/__chef/enter?t=${expired}`), env)).status).toBe(401);
    const elsewhere = await appEntry("https://other-chef-dev-app.example.workers.dev", KEY, { path: "/", now });
    expect((await app.fetch(new Request(`${ORIGIN}/__chef/enter?${new URL(elsewhere).search.slice(1)}`), env)).status).toBe(401);
    expect((await app.fetch(new Request(await appEntry(ORIGIN, newAppKey(), { path: "/", now })), env)).status).toBe(401);
    const entered = await app.fetch(new Request(await appEntry(ORIGIN, KEY, { path: "//evil.example", now })), env);
    expect(entered.headers.get("location")).toBe("/");
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: { cookie: cookieOf(entered) } }), { ...env, CHEF_APP_KEY: newAppKey() })).status).toBe(401);
    const asCookie = await signAppPass(KEY, { use: "enter", host: new URL(ORIGIN).hostname, expiresAt: now + 60_000 });
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: { cookie: `__Host-chef_app=${asCookie}` } }), env)).status).toBe(401);
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: html }), {})).status).toBe(503);
    expect(seen.target).toBeUndefined();
  });

  it("answers with a page of its own when the sandbox cannot be reached, as while its project is deleted", async () => {
    const app = await router();
    const gone = { idFromName: (name: string) => name, get: () => ({ fetch: () => Promise.reject(new Error("destroyed")) }) };
    const env = { CHEF_APP_KEY: KEY, CHEF_TARGET: "s1", SESSION: gone };
    const entered = await app.fetch(new Request(await appEntry(ORIGIN, KEY, { path: "/", now: Date.now() })), env);
    const page = await app.fetch(new Request(`${ORIGIN}/`, { headers: { ...html, cookie: cookieOf(entered) } }), env);
    expect(page.status).toBe(503);
    expect(await page.text()).toContain("This app is not available right now");
    const script = await app.fetch(new Request(`${ORIGIN}/client.js`, { headers: { cookie: cookieOf(entered) } }), env);
    expect(script.status).toBe(503);
    expect(await script.json()).toMatchObject({ error: expect.stringContaining("stopped or deleted") });
  });
});
