import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { gateModule, newPreviewKey, previewEntry, previewMain, previewPass, PREVIEW_GATE_FILE, PREVIEW_PASS_HEADER, signPreviewPass } from "../../src/preview-gate.ts";

type Handler = { fetch(request: Request, env: Record<string, unknown>, ctx?: unknown): Promise<Response> };

const ORIGIN = "https://feature-x-chef-dev-shop.example.workers.dev";
const KEY = newPreviewKey();
const ECHO = `export class StoreObject {}
export default {
  async fetch(request, env) {
    return Response.json({ path: new URL(request.url).pathname, cookie: request.headers.get("cookie"), pass: request.headers.get("${PREVIEW_PASS_HEADER}"), sawKey: "CHEF_PREVIEW_KEY" in env, other: env.OTHER ?? null });
  },
  scheduled() {
    return "ran";
  },
};
`;

async function gated(app = ECHO, main = "src/index.mjs"): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "chef-gate-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, ".chef"));
  writeFileSync(join(dir, main), app);
  writeFileSync(join(dir, PREVIEW_GATE_FILE), gateModule(main));
  return (await import(pathToFileURL(join(dir, PREVIEW_GATE_FILE)).href)) as Record<string, unknown>;
}

const env = { CHEF_PREVIEW_KEY: KEY, OTHER: "x" };
const html = { accept: "text/html" };

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] as string;
}

describe("preview gate", () => {
  it("lets a fresh link from Chef in once, then remembers the visitor with a cookie that works inside Chef's frame", async () => {
    const mod = await gated();
    const app = mod["default"] as Handler;
    const entry = await previewEntry(ORIGIN, KEY, { path: "/todos?x=1", now: Date.now() });
    expect(entry.startsWith(`${ORIGIN}/__chef/enter?t=`)).toBe(true);
    const entered = await app.fetch(new Request(entry), env);
    expect(entered.status).toBe(302);
    expect(entered.headers.get("location")).toBe("/todos?x=1");
    const setCookie = entered.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-chef_preview=[^;]+; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=None; Partitioned$/);
    const page = await app.fetch(new Request(`${ORIGIN}/todos`, { headers: { cookie: `theme=dark; ${cookieOf(entered)}` } }), env);
    expect(page.status).toBe(200);
    expect(await page.json()).toEqual({ path: "/todos", cookie: "theme=dark", pass: null, sawKey: false, other: "x" });
    expect(mod["StoreObject"]).toBeTypeOf("function");
    expect((app as unknown as { scheduled(): string }).scheduled()).toBe("ran");
  });

  it("turns away anyone without a valid way in, and never passes Chef's own headers to the app", async () => {
    const app = (await gated())["default"] as Handler;
    const now = Date.now();
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: html }), env)).status).toBe(401);
    expect(await (await app.fetch(new Request(`${ORIGIN}/api/todos`), env)).json()).toMatchObject({ error: expect.stringContaining("Previews are private") });
    const expired = await signPreviewPass(KEY, { use: "enter", host: new URL(ORIGIN).hostname, expiresAt: now - 1 });
    expect((await app.fetch(new Request(`${ORIGIN}/__chef/enter?t=${expired}`), env)).status).toBe(401);
    const elsewhere = await previewEntry("https://other-preview.example.workers.dev", KEY, { path: "/", now });
    expect((await app.fetch(new Request(`${ORIGIN}/__chef/enter?${new URL(elsewhere).search.slice(1)}`), env)).status).toBe(401);
    const otherKey = await previewEntry(ORIGIN, newPreviewKey(), { path: "/", now });
    expect((await app.fetch(new Request(otherKey), env)).status).toBe(401);
    const entered = await app.fetch(new Request(await previewEntry(ORIGIN, KEY, { path: "//evil.example", now })), env);
    expect(entered.headers.get("location")).toBe("/");
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: { cookie: cookieOf(entered) } }), { ...env, CHEF_PREVIEW_KEY: newPreviewKey() })).status).toBe(401);
    const asCookie = await signPreviewPass(KEY, { use: "enter", host: new URL(ORIGIN).hostname, expiresAt: now + 60_000 });
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: { cookie: `__Host-chef_preview=${asCookie}` } }), env)).status).toBe(401);
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: html }), {})).status).toBe(503);
  });

  it("lets Chef's own checks in with a short pass header and hides it from the app", async () => {
    const app = (await gated())["default"] as Handler;
    const pass = await previewPass(`${ORIGIN}/`, KEY, Date.now());
    expect(pass.host).toBe(new URL(ORIGIN).hostname);
    const response = await app.fetch(new Request(`${ORIGIN}/api/todos`, { headers: { [PREVIEW_PASS_HEADER]: pass.token } }), env);
    expect(await response.json()).toMatchObject({ path: "/api/todos", pass: null, cookie: null });
    const wrongUse = await previewEntry(ORIGIN, KEY, { path: "/", now: Date.now() });
    expect((await app.fetch(new Request(`${ORIGIN}/`, { headers: { [PREVIEW_PASS_HEADER]: new URL(wrongUse).searchParams.get("t") as string } }), env)).status).toBe(401);
  });

  it("gives every proof pass its own empty storage and leaves what visitors saved alone", async () => {
    const app = `export default {
  async fetch(request, env) {
    const store = env.STORE.get(env.STORE.idFromName("app"));
    if (request.method === "POST") store.notes.push(await request.text());
    return Response.json({ notes: store.notes, name: store.name });
  },
};
`;
    const objects = new Map<string, { name: string; notes: string[] }>();
    const STORE = {
      idFromName: (name: string) => name,
      get(id: string) {
        let object = objects.get(id);
        if (!object) objects.set(id, (object = { name: id, notes: [] }));
        return object;
      },
    };
    const handler = (await gated(app))["default"] as Handler;
    const stored = { ...env, STORE };
    const entered = await handler.fetch(new Request(await previewEntry(ORIGIN, KEY, { path: "/", now: Date.now() })), stored);
    const visitor = { cookie: cookieOf(entered) };
    await handler.fetch(new Request(`${ORIGIN}/api/notes`, { method: "POST", body: "mine", headers: visitor }), stored);
    const first = await previewPass(ORIGIN, KEY, Date.now());
    const proof = (token: string, init: RequestInit = {}) => handler.fetch(new Request(`${ORIGIN}/api/notes`, { ...init, headers: { [PREVIEW_PASS_HEADER]: token } }), stored);
    expect(await (await proof(first.token)).json()).toMatchObject({ notes: [] });
    await proof(first.token, { method: "POST", body: "from proof" });
    expect(await (await proof(first.token)).json()).toMatchObject({ notes: ["from proof"] });
    const second = await previewPass(ORIGIN, KEY, Date.now());
    expect(await (await proof(second.token)).json()).toMatchObject({ notes: [] });
    const seen = (await (await handler.fetch(new Request(`${ORIGIN}/api/notes`, { headers: visitor }), stored)).json()) as { notes: string[]; name: string };
    expect(seen).toEqual({ notes: ["mine"], name: "app" });
  });

  it("wraps an app whose default export is a class", async () => {
    const app = `export default class App { constructor(env) { this.env = env; } async fetch(request) { return new Response("class " + new URL(request.url).pathname); } }`;
    const Gated = (await gated(app))["default"] as new (env: Record<string, unknown>) => { fetch(request: Request): Promise<Response> };
    const entered = await new Gated(env).fetch(new Request(await previewEntry(ORIGIN, KEY, { path: "/a", now: Date.now() })));
    expect(await (await new Gated(env).fetch(new Request(`${ORIGIN}/a`, { headers: { cookie: cookieOf(entered) } }))).text()).toBe("class /a");
    expect((await new Gated(env).fetch(new Request(`${ORIGIN}/a`))).status).toBe(401);
  });

  it("finds the app's entry module from its wrangler config", () => {
    expect(previewMain({ "wrangler.jsonc": '{\n  // x\n  "name": "a",\n  "main": "src/index.ts"\n}' })).toBe("src/index.ts");
    expect(previewMain({ "wrangler.json": '{"main":"./worker/main.js"}' })).toBe("./worker/main.js");
    expect(previewMain({ "wrangler.toml": 'name = "a"\nmain = "app/entry.ts"\n' })).toBe("app/entry.ts");
    expect(previewMain({})).toBe("src/index.ts");
    expect(gateModule("./worker/main.js")).toContain('import * as app from "../worker/main.js";');
  });
});
