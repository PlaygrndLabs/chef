import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/fakes/index.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const PROMPT = "Add an item to a todo list";

class HeldStore extends MemoryStore {
  private held: { key: string; until: Promise<void> } | null = null;
  private reached: () => void = () => undefined;

  hold(key: string): { reached: Promise<void>; release: () => void } {
    let release = (): void => undefined;
    const until = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (this.reached = resolve));
    this.held = { key, until };
    return { reached, release };
  }

  override async get<T>(key: string): Promise<T | undefined> {
    const value = await super.get<T>(key);
    const held = this.held;
    if (held?.key === key) {
      this.held = null;
      this.reached();
      await held.until;
    }
    return value;
  }
}

describe("stale session saves", () => {
  it("never puts a merged session back to gating when a write that read it before the merge lands after", async () => {
    const store = new HeldStore();
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), deps: { store } });
    await w.orchestrator.bootstrap(templateTree());
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    for (let i = 0; i < 30 && (await w.orchestrator.session(id)).machine.state !== "gating"; i++) await w.orchestrator.step(id);
    expect((await w.orchestrator.session(id)).machine.state).toBe("gating");

    const stale = store.hold(`session/${id}`);
    await w.orchestrator.editFeatureMap({ kind: "add", parent: null, title: "Later wish" });
    await stale.reached;
    expect((await w.orchestrator.run(id)).machine.state).toBe("merged");
    stale.release();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const record = await w.orchestrator.session(id);
    expect(record.machine.state).toBe("merged");
    expect(record.forkDeleted).toBe(true);
  });
});
