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

describe("the live project feed", () => {
  beforeEach(() => {
    FakeSocket.opened = [];
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    vi.stubGlobal("location", { protocol: "https:", host: "chef.test" });
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 0));
    vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the whole history in one go before it reports the project ready, then listens from where it stopped", async () => {
    const { fetch, calls } = serveEvents(1200);
    vi.stubGlobal("fetch", fetch);
    const store = new Store();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.state.routes.length));
    const caughtUp = vi.fn();
    const stop = connectFeed({ project: "shop", store, onEvents: () => undefined, onConnection: () => undefined, onCaughtUp: caughtUp });
    await settle();
    await settle();
    expect(calls).toEqual([0, 500, 1000]);
    expect(caughtUp).toHaveBeenCalledTimes(1);
    expect(store.state.lastSeq).toBe(1200);
    expect(seen).toEqual([200]);
    expect(FakeSocket.opened.map((s) => s.url)).toEqual(["wss://chef.test/agents/project/shop?after=1200"]);
    stop();
    expect(FakeSocket.opened[0]?.closed).toBe(true);
  });

  it("applies pushed events and catches up over HTTP when the socket skips some", async () => {
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
    const connection: Connection[] = [];
    const stop = connectFeed({ project: "shop", store, onEvents: () => undefined, onConnection: (c) => connection.push(c), onCaughtUp: () => undefined });
    await settle();
    await settle();
    const socket = FakeSocket.opened[0] as FakeSocket;
    socket.emit("open");
    socket.emit("message", entry(4));
    expect(store.state.lastSeq).toBe(4);
    total = 7;
    socket.emit("message", entry(7));
    await settle();
    await settle();
    expect(store.state.lastSeq).toBe(7);
    expect(calls.at(-1)).toBe(4);
    expect(connection).toContain("live");
    stop();
  });

  it("stays not ready while the server cannot be reached, and becomes ready once polling gets through", async () => {
    let up = false;
    const { fetch } = serveEvents(2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (up ? fetch(url) : ({ ok: false, status: 503 } as Response))),
    );
    const store = new Store();
    const caughtUp = vi.fn();
    const connection: Connection[] = [];
    const stop = connectFeed({ project: "shop", store, onEvents: () => undefined, onConnection: (c) => connection.push(c), onCaughtUp: caughtUp });
    await settle();
    expect(caughtUp).not.toHaveBeenCalled();
    expect(connection).toEqual(["offline"]);
    up = true;
    (FakeSocket.opened[0] as FakeSocket).emit("open");
    await settle();
    await settle();
    expect(caughtUp).toHaveBeenCalledTimes(1);
    expect(store.state.lastSeq).toBe(2);
    stop();
  });
});
