import { describe, expect, it } from "vitest";
import { runVoice } from "../../src/voice.ts";

describe("voice front end", () => {
  it("a spoken request routes and ships a feature with real checks and no human action", { timeout: 120_000 }, async () => {
    const run = await runVoice({ say: "Add an item to a to-do list.", live: false, real: true });
    expect(run.heard).toBe("Add an item to a to-do list.");
    expect(run.intent).toBe("new_feature");
    expect(run.featureId).toBe("todo-add");
    expect(run.reply).toContain("todo-add");
    expect(run.state).toBe("merged");
    expect(run.humanActions).toBe(0);
  });
});
