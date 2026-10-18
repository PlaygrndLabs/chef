import { describe, expect, it } from "vitest";
import type { ChefEvent } from "@chef/core";
import { DurableEventBus } from "../../src/event-bus.ts";

function storage() {
  const data = new Map<string, unknown>();
  return {
    get: async (key: string) => data.get(key),
    put: async (entries: Record<string, unknown>) => void Object.entries(entries).forEach(([key, value]) => data.set(key, value)),
    delete: async (key: string) => data.delete(key),
    list: async ({ prefix, start, limit }: { prefix: string; start: string; limit: number }) => new Map([...data].filter(([key]) => key.startsWith(prefix) && key >= start).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)),
  } as unknown as DurableObjectStorage;
}

describe("the event bus", () => {
  it("reads one session's events across pages and says where to go on", async () => {
    const bus = new DurableEventBus(storage(), () => undefined);
    for (let i = 0; i < 1200; i++) await bus.publish({ type: "session.stuck", at: i, sessionId: i % 3 === 0 ? "s-1" : "s-2", reason: "x" } as unknown as ChefEvent);
    const first = await bus.ofSession("s-1", 0, 600);
    expect(first.done).toBe(false);
    expect(first.after).toBe(1000);
    expect(first.entries.every((entry) => (entry.event as { sessionId: string }).sessionId === "s-1")).toBe(true);
    const rest = await bus.ofSession("s-1", first.after);
    expect(rest.done).toBe(true);
    expect(rest.after).toBe(1200);
    expect(first.entries.length + rest.entries.length).toBe(400);
  });
});
