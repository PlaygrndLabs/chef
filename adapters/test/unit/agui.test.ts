import { describe, expect, it } from "vitest";
import type { ChefEvent, SubmitResult } from "@chef/core";
import { SessionStream, summaryLine } from "../../src/agui.ts";

const result = (ids: readonly string[]): SubmitResult => ({ decision: { intent: "new_feature", featureId: null, changeKind: null, via: "rules", confidence: 1, reason: "" }, sessionId: ids[0] ?? null, sessionIds: [...ids] });

const at = { project: "shop", at: 1 } as const;

describe("the chat summary line", () => {
  it("says where each feature was merged", () => {
    let n = 0;
    const stream = new SessionStream("notes and tags", result(["s1", "s2"]), () => `m${++n}`);
    const events: ChefEvent[] = [
      { ...at, type: "main.merged", sessionId: "s1", featureId: "notes", commitId: "aaaaaaaaaaaaaaaa" },
      { ...at, type: "session.state", sessionId: "s1", featureId: "notes", from: "gating", to: "merged", reason: "merged" },
      { ...at, type: "branch.merged", sessionId: "s2", featureId: "tags", into: "s1", intoFeature: "notes", commitId: "bbbbbbbbbbbbbbbb" },
      { ...at, type: "session.state", sessionId: "s2", featureId: "tags", from: "gating", to: "merged", reason: "merged" },
    ];
    for (const event of events) stream.push(event);
    expect(summaryLine(stream.snapshot())).toBe("s1 merged into main as aaaaaaaaaaaa.\ns2 merged into notes as bbbbbbbbbbbb.");
  });
});
