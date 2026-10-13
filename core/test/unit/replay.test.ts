import { describe, expect, it } from "vitest";
import { replayFrom } from "../../src/events/replay.ts";

describe("where a live event socket starts its replay", () => {
  it("reads the after cursor from the socket URL", () => {
    expect(replayFrom("/agents/project/shop?after=42")).toBe(42);
    expect(replayFrom("https://chef.example/agents/project/shop?after=7")).toBe(7);
  });

  it("replays everything when the cursor is missing or invalid", () => {
    expect(replayFrom("/agents/project/shop")).toBe(0);
    expect(replayFrom("/agents/project/shop?after=-3")).toBe(0);
    expect(replayFrom("/agents/project/shop?after=abc")).toBe(0);
    expect(replayFrom("/agents/project/shop?after=1.5")).toBe(0);
  });
});
