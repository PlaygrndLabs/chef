import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChefEvent } from "@chef/core";
import { LocalGitHost } from "@chef/adapters/local-git";
import { startApp, type LocalApp } from "../../src/app.ts";
import { Docker } from "../../src/engine/docker.ts";
import { LocalEngine } from "../../src/engine/engine.ts";
import { FileEventBus, FileMemoryIndex, FileStore } from "../../src/engine/storage.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "chef-engine-"));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("local storage", () => {
  it("keeps the store, the event log and memory across restarts", async () => {
    const dir = temp();
    const store = new FileStore(join(dir, "store.jsonl"));
    await store.put("session/a", { state: "coding" });
    await store.put("session/a", { state: "merged" });
    await store.put("session/b", null);
    const bus = new FileEventBus(join(dir, "events.jsonl"));
    await bus.publish({ type: "main.merged", featureId: "todo-add" } as ChefEvent);
    await bus.publish({ type: "main.merged", featureId: "todo-done" } as ChefEvent);
    const memory = new FileMemoryIndex(join(dir, "memory.json"));
    await memory.upsert([{ path: "spec/features/todo-add.md", kind: "feature", feature: "todo-add", text: "Add an item to the todo list" }]);

    const again = new FileStore(join(dir, "store.jsonl"));
    expect(await again.get("session/a")).toEqual({ state: "merged" });
    expect([...(await again.list("session/")).keys()]).toEqual(["session/a", "session/b"]);
    const log = new FileEventBus(join(dir, "events.jsonl"));
    expect(await log.cursor()).toBe(2);
    expect((await log.since(1)).map((e) => e.seq)).toEqual([2]);
    const recalled = await new FileMemoryIndex(join(dir, "memory.json")).query("todo item", 3);
    expect(recalled[0]?.doc.feature).toBe("todo-add");
  });

  it("finds repos again after a restart and imports another git repository", async () => {
    const dir = temp();
    const git = new LocalGitHost(join(dir, "repos"));
    await git.start();
    const control = git.control();
    await control.create("source", { defaultBranch: "main" });
    await git.close();
    const restarted = new LocalGitHost(join(dir, "repos"));
    await restarted.start();
    expect(await restarted.control().info("source")).toMatchObject({ name: "source", defaultBranch: "main" });
    expect(await restarted.control().info("missing")).toBeNull();
    await expect(restarted.control().import?.("copy", { url: join(dir, "nowhere.git"), branch: "main" })).rejects.toThrow(/importing/);
    expect(await restarted.control().info("copy")).toBeNull();
    await restarted.close();
  });
});

describe("chef running fully on this computer", () => {
  let engine: LocalEngine;
  let app: LocalApp;
  let dir: string;

  beforeAll(async () => {
    dir = temp();
    engine = await LocalEngine.start({ dir, env: {}, docker: new Docker({ repos: join(dir, "repos"), docker: "true" }) });
    app = await startApp({ port: 0, engine });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = (path: string, init?: RequestInit) => fetch(`${app.url}${path}`, { ...init, headers: { ...(init?.body ? { "content-type": "application/json", origin: app.url } : {}), ...init?.headers } });

  it("tells the dashboard it runs here and keeps keys in its own settings file", async () => {
    expect(await (await api("/api/app")).json()).toEqual({ mode: "computer", engine: null, fixed: true });
    expect((await api("/api/app/connection", { method: "PUT", body: "{}" })).status).toBe(409);
    const before = (await (await api("/api/settings")).json()) as { llm: unknown; runsOn: string; password: string; dataDir: string };
    expect(before).toMatchObject({ llm: null, runsOn: "computer", password: "none", dataDir: dir });
    const saved = await api("/api/settings", { method: "PUT", body: JSON.stringify({ llm: { kind: "anthropic", apiKey: "sk-ant-test-1234567890" } }) });
    expect(((await saved.json()) as { llm: { keyHint: string } }).llm.keyHint).toBe("…7890");
    expect((await api("/api/settings", { method: "PUT", body: JSON.stringify({ password: "a-new-password" }) })).status).toBe(409);
    expect((await (await api("/api/github")).json()) as object).toMatchObject({ available: false, app: null });
  });

  it("creates a project from the template, serves its spec and event log, and remembers it", async () => {
    const created = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "notes" }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name: "notes", created: true });
    expect((await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "notes" }) })).status).toBe(409);
    const spec = (await (await api("/api/projects/notes/spec")).json()) as { commitId: string | null };
    expect(spec.commitId).toMatch(/^[0-9a-f]{40}$/);
    expect(await (await api("/api/projects/notes/sessions")).json()).toEqual([]);
    expect(await (await api("/api/projects/notes/settings")).json()).toMatchObject({ git: null });
    expect((await api("/api/projects/notes/settings", { method: "PUT", body: JSON.stringify({ git: { url: "https://github.com/a/b", branch: "main", github: true, mode: "pull-request", syncBranch: "chef" } }) })).status).toBe(409);
    expect((await api("/api/projects/other/spec")).status).toBe(404);
    const missing = await api("/preview/notes/nothing-here");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("No preview yet");

    const second = await LocalEngine.start({ dir, env: {}, docker: new Docker({ repos: join(dir, "repos"), docker: "true" }) });
    const listed = (await (await second.handle(new Request("http://localhost/api/projects"))).json()) as { projects: { name: string }[] };
    expect(listed.projects.map((p) => p.name)).toEqual(["notes"]);
    const respec = (await (await second.handle(new Request("http://localhost/api/projects/notes/spec"))).json()) as { commitId: string };
    expect(respec.commitId).toBe(spec.commitId);
    await second.close();
  });

  it("streams the project's events over a WebSocket to its own pages only", async () => {
    await new FileEventBus(join(dir, "projects", "logs", "events.jsonl")).publish({ type: "main.merged", featureId: "todo-add" } as ChefEvent);
    expect((await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "logs" }) })).status).toBe(201);
    const frame = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(`${app.url}/agents/project/logs`, { headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } });
      req.on("upgrade", (response, socket, head: Buffer) => {
        expect(response.headers["sec-websocket-accept"]).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
        const read = (chunk: Buffer) => {
          socket.destroy();
          const short = (chunk[1] as number) & 0x7f;
          const offset = short === 126 ? 4 : 2;
          resolve(chunk.subarray(offset, offset + (short === 126 ? chunk.readUInt16BE(2) : short)).toString("utf8"));
        };
        if (head.length) read(head);
        else socket.once("data", read);
      });
      req.on("error", reject);
      req.end();
    });
    expect(JSON.parse(frame)).toMatchObject({ seq: 1, event: { type: "main.merged" } });
    const refused = await new Promise<number>((resolve) => {
      const req = httpRequest(`${app.url}/agents/project/notes`, { headers: { connection: "Upgrade", upgrade: "websocket", origin: "https://evil.example", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } });
      req.on("upgrade", () => resolve(101));
      req.on("response", (response) => resolve(response.statusCode ?? 0));
      req.on("error", () => resolve(403));
      req.end();
    });
    expect(refused).toBe(403);
  });
});
