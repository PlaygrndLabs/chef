import { describe, expect, it } from "vitest";
import { ManualClock, MemoryPreviewHost, MemoryRepoHost, MemoryStore } from "../../src/fakes/index.ts";
import { PreviewKeeper, type PreviewSpace } from "../../src/previews/keeper.ts";

const HOUR = 60 * 60_000;

async function setup() {
  const clock = new ManualClock();
  const repos = new MemoryRepoHost(clock);
  await repos.createRepo("demo");
  const token = await repos.createToken("demo", "write", 600);
  const first = await repos.commit(token, { ref: "main", parent: null, changes: { "a.txt": "a" }, message: "init", author: { name: "t", email: "ma.karimi76@gmail.com" } });
  await repos.pushRef(token, { ref: "preview/todo-add", commitId: first.id });
  const host = new MemoryPreviewHost();
  const removed: (readonly string[])[] = [];
  let failNext: string | null = null;
  const space: PreviewSpace = { remove: async (branches) => void removed.push(branches) };
  const flaky = {
    deploy: async (input: { repo: string; branch: string; commitId: string }) => {
      if (failNext) {
        const message = failNext;
        failNext = null;
        throw new Error(message);
      }
      return host.deploy(input);
    },
    current: (input: { repo: string; branch: string }) => host.current(input),
  };
  let activity = 0;
  const keeper = new PreviewKeeper(flaky, space, { repos, store: new MemoryStore(), clock, canonical: "demo", onActivity: () => void activity++ });
  return { clock, keeper, host, removed, commit: first.id, fail: (message: string) => (failNext = message), activity: () => activity };
}

describe("preview keeper", () => {
  it("serves a deployed preview, removes its previews after idle, and rebuilds it on the next visit", async () => {
    const t = await setup();
    await t.keeper.deploy({ repo: "demo", branch: "preview/todo-add", commitId: t.commit });
    expect(await t.keeper.visit("todo-add")).toMatchObject({ status: "ready", commitId: t.commit });
    expect(t.activity()).toBe(2);

    t.clock.advance(HOUR / 2);
    expect(await t.keeper.sweep({ busy: false, idleMs: HOUR })).toEqual({ status: "awake", idleForMs: HOUR / 2 });
    t.clock.advance(HOUR);
    expect(await t.keeper.sweep({ busy: true, idleMs: HOUR })).toEqual({ status: "busy" });
    expect(t.removed).toHaveLength(0);
    expect(await t.keeper.sweep({ busy: false, idleMs: HOUR })).toEqual({ status: "removed", previews: 1 });
    expect(t.removed).toEqual([["preview/todo-add"]]);
    expect(await t.keeper.sweep({ busy: false, idleMs: HOUR })).toEqual({ status: "asleep" });
    expect(await t.keeper.current({ repo: "demo", branch: "preview/todo-add" })).toBeNull();

    expect(await t.keeper.visit("todo-add")).toEqual({ status: "rebuild" });
    await t.keeper.startRebuild("todo-add");
    expect((await t.keeper.visit("todo-add")).status).toBe("building");
    expect(await t.keeper.rebuild("todo-add")).toMatchObject({ status: "ready", commitId: t.commit });
    expect(await t.keeper.visit("todo-add")).toMatchObject({ status: "ready" });
    expect(t.host.deployments).toHaveLength(2);
    expect(await t.keeper.live()).toBe(true);
  });

  it("builds a preview again when the keeper needs a gate and the preview has none", async () => {
    const clock = new ManualClock();
    const repos = new MemoryRepoHost(clock);
    await repos.createRepo("demo");
    const token = await repos.createToken("demo", "write", 600);
    const first = await repos.commit(token, { ref: "main", parent: null, changes: { "a.txt": "a" }, message: "init", author: { name: "t", email: "ma.karimi76@gmail.com" } });
    await repos.pushRef(token, { ref: "preview/todo-add", commitId: first.id });
    const host = new MemoryPreviewHost();
    let gate = false;
    const space: PreviewSpace = { remove: async () => undefined };
    const keeper = new PreviewKeeper({ deploy: async (input) => ({ ...(await host.deploy(input)), gated: gate }), current: (input) => host.current(input) }, space, { repos, store: new MemoryStore(), clock, canonical: "demo", gated: true });
    await keeper.deploy({ repo: "demo", branch: "preview/todo-add", commitId: first.id });
    expect(await keeper.visit("todo-add")).toEqual({ status: "rebuild" });
    gate = true;
    expect(await keeper.rebuild("todo-add")).toMatchObject({ status: "ready" });
    expect(await keeper.visit("todo-add")).toMatchObject({ status: "ready", commitId: first.id });
  });

  it("reports a failed rebuild and a feature without a preview branch", async () => {
    const t = await setup();
    expect(await t.keeper.sweep({ busy: false, idleMs: HOUR })).toEqual({ status: "removed", previews: 0 });
    expect(await t.keeper.visit("nope")).toEqual({ status: "missing" });
    t.fail("wrangler preview failed: quota");
    expect(await t.keeper.rebuild("todo-add")).toEqual({ status: "failed", error: "wrangler preview failed: quota" });
    expect(await t.keeper.visit("todo-add")).toEqual({ status: "failed", error: "wrangler preview failed: quota" });
    expect(await t.keeper.rebuild("todo-add")).toMatchObject({ status: "ready" });
  });
});
