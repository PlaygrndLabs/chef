import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startApp, type LocalApp } from "../../src/app.ts";
import { LocalEngine } from "../../src/engine/engine.ts";

const enabled = process.env["CHEF_LIVE_LOCAL"] === "1";

interface Session {
  readonly id: string;
  readonly featureId: string;
  readonly previewKey?: string;
  readonly machine: { readonly state: string };
}

describe.skipIf(!enabled)("chef fully on this computer with a real model", () => {
  const dir = mkdtempSync(join(tmpdir(), "chef-live-"));
  let engine: LocalEngine | null = null;
  let app: LocalApp | null = null;

  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("plans, builds, checks, previews and merges a feature with everything on this machine", async () => {
    engine = await LocalEngine.start({ dir, log: (line) => process.stderr.write(`${line}\n`) });
    app = await startApp({ port: 0, engine });
    const base = app.url;
    const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", origin: base } });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      return (await response.json()) as T;
    };
    expect(await call<{ llm: unknown }>("/api/settings")).toMatchObject({ runsOn: "computer", llm: { source: "deployment" } });
    await call("/api/projects", { method: "POST", body: JSON.stringify({ name: "todo" }) });
    await call("/api/projects/todo/prompts", { method: "POST", body: JSON.stringify({ prompt: "Add an item to a todo list" }) });
    const deadline = Date.now() + 40 * 60_000;
    let sessions: Session[];
    for (;;) {
      sessions = await call<Session[]>("/api/projects/todo/sessions");
      process.stderr.write(`${sessions.map((s) => `${s.featureId}:${s.machine.state}`).join(" ")}\n`);
      if (sessions.length > 0 && sessions.every((s) => ["merged", "stuck", "dropped"].includes(s.machine.state))) break;
      if (Date.now() > deadline) throw new Error("the session did not finish in time");
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    const merged = sessions.find((s) => s.machine.state === "merged");
    expect(merged, JSON.stringify(sessions.map((s) => s.machine))).toBeDefined();
    const spec = await call<{ features: { id: string }[] }>("/api/projects/todo/spec");
    expect(spec.features.map((f) => f.id)).toContain(merged?.featureId);
    const key = merged?.previewKey ?? merged?.featureId;
    let preview = await fetch(`${base}/preview/todo/${key}`, { redirect: "manual" });
    for (let i = 0; i < 60 && preview.status === 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      preview = await fetch(`${base}/preview/todo/${key}`, { redirect: "manual" });
    }
    expect(preview.status).toBe(302);
    const page = await fetch(preview.headers.get("location") ?? "");
    expect(page.status).toBe(200);
  }, 45 * 60_000);
});
