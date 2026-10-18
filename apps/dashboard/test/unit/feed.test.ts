import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../src/lib/events.ts";
import { connectFeed, Store, type Connection } from "../../src/lib/live.ts";

class FakeSocket {
  static opened: FakeSocket[] = [];
  readonly listeners = new Map<string, ((event: { data?: string }) => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(data === undefined ? {} : { data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

const entry = (seq: number): LogEntry => ({ seq, event: { type: "route.decided", project: "shop", at: seq, prompt: `p${seq}`, decision: { intent: "new_feature", featureId: `f${seq}`, confidence: 0.9 } } as unknown as LogEntry["event"] });

function serveEvents(total: number) {
  const calls: number[] = [];
  const fetch = vi.fn(async (url: string) => {
    const after = Number(new URL(url, "http://chef.test").searchParams.get("after"));
    calls.push(after);
    const page = Array.from({ length: Math.max(0, Math.min(500, total - after)) }, (_, i) => entry(after + i + 1));
    return { ok: true, json: async () => page } as Response;
  });
  return { fetch, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let ticks: (() => void)[] = [];

describe("the live project feed", () => {
  beforeEach(() => {
    FakeSocket.opened = [];
    ticks = [];
    vi.stubGlobal("window", { setInterval: (tick: () => void) => ticks.push(tick), clearInterval: () => undefined, setTimeout, clearTimeout });
    vi.stubGlobal("location", { protocol: "https:", host: "chef.test" });
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 0));
    vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replays the history over the socket and reports the project ready once, at the end marker", async () => {
    const { fetch, calls } = serveEvents(1200);
    vi.stubGlobal("fetch", fetch);
    const store = new Store();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.state.routes.length));
    const caughtUp = vi.fn();
    const stop = connectFeed({ project: "shop", store, onEvents: () => undefined, onConnection: () => undefined, onCaughtUp: caughtUp });
    const socket = FakeSocket.opened[0] as FakeSocket;
    expect(socket.url).toBe("wss://chef.test/agents/project/shop?after=0");
    socket.emit("open");
    for (let seq = 1; seq <= 1200; seq++) socket.emit("message", entry(seq));
    await settle();
    expect(caughtUp).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    socket.emit("message", { caughtUp: 1200 });
    expect(caughtUp).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([200]);
    expect(store.state.lastSeq).toBe(1200);
    expect(calls).toEqual([]);
    socket.emit("message", entry(1201));
    await settle();
    expect(seen).toEqual([200, 200]);
    expect(store.state.lastSeq).toBe(1201);
    stop();
    expect(socket.closed).toBe(true);
  });

  it("catches up over HTTP when the socket skips events or the end marker is ahead", async () => {
    let total = 3;
    const { fetch, calls } = serveEvents(Number.POSITIVE_INFINITY);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const response = await fetch(url);
        const page = (await response.json()) as LogEntry[];
        return { ok: true, json: async () => page.filter((e) => e.seq <= total) } as Response;
      }),
    );
    const store = new Store();
    const caughtUp = vi.fn();
    const connection: Connection[] = [];
    const stop = connectFeed({ project: "shop", store, onEvents: () => undefined, onConnection: (c) => connection.push(c), onCaughtUp: caughtUp });
    const socket = FakeSocket.opened[0] as FakeSocket;
    socket.emit("open");
    socket.emit("message", entry(1));
    socket.emit("message", { caughtUp: 3 });
    await settle();
    await settle();
    expect(store.state.lastSeq).toBe(3);
    expect(caughtUp).toHaveBeenCalledTimes(1);
    total = 7;
    socket.emit("message", entry(4));
    expect(store.state.lastSeq).toBe(4);
    socket.emit("message", entry(7));
    await settle();
    await settle();
    expect(store.state.lastSeq).toBe(7);
    expect(calls).toEqual([1, 4]);
    expect(connection).toContain("live");
    stop();
  });

  it("catches up over HTTP when the socket hangs without opening, and stops polling once it opens", async () => {
    const timers: (() => void)[] = [];
    let cleared = 0;
    vi.stubGlobal("window", { setInterval: (tick: () => void) => ticks.push(tick), clearInterval: () => void cleared++, setTimeout: (run: () => void) => timers.push(run), clearTimeout: () => undefined });
    const { fetch, calls } = serveEvents(3);
    vi.stubGlobal("fetch", fetch);
    const store = new Store();
    const caughtUp = vi.fn();
    const stop = connectFeed({ project: "shop", store, onEvents: () => undefined, onConnection: () => undefined, onCaughtUp: caughtUp });
    await settle();
    expect(calls).toEqual([]);
    timers.forEach((run) => run());
    for (let i = 0; i < 4; i++) await settle();
    expect(calls).toEqual([0]);
    expect(caughtUp).toHaveBeenCalledTimes(1);
    expect(store.state.lastSeq).toBe(3);
    expect(ticks).toHaveLength(1);
    (FakeSocket.opened[0] as FakeSocket).emit("open");
    expect(cleared).toBe(1);
    stop();
  });

  it("falls back to HTTP when the socket fails, and stays not ready until the server answers", async () => {
    let up = false;
    const { fetch } = serveEvents(1200);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (up ? fetch(url) : ({ ok: false, status: 503 } as Response))),
    );
    const store = new Store();
    const caughtUp = vi.fn();
    const connection: Connection[] = [];
    const stop = connectFeed({ project: "shop", store, onEvents: () => undefined, onConnection: (c) => connection.push(c), onCaughtUp: caughtUp });
    (FakeSocket.opened[0] as FakeSocket).emit("error");
    await settle();
    expect(caughtUp).not.toHaveBeenCalled();
    expect(connection).toEqual(["offline"]);
    up = true;
    ticks.forEach((tick) => tick());
    for (let i = 0; i < 6; i++) await settle();
    expect(caughtUp).toHaveBeenCalledTimes(1);
    expect(store.state.lastSeq).toBe(1200);
    expect(connection.at(-1)).toBe("polling");
    stop();
  });
});
