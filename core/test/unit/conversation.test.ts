import { describe, expect, it } from "vitest";
import { chatContext, needsCompacting, plainSummary, readChatMemory, renderConversation, splitForCompacting } from "../../src/router/conversation.ts";

const turns = (n: number, size = 400) => Array.from({ length: n }, (_, i) => ({ prompt: `ask ${i} ${"x".repeat(size)}`, reply: `reply ${i}`, at: i }));

describe("main chat memory", () => {
  it("starts empty and renders the summary before the recent messages", () => {
    expect(readChatMemory(undefined)).toEqual({ summary: "", turns: [] });
    const text = renderConversation({ summary: "- built todo-list", turns: turns(2, 1) });
    expect(text.indexOf("Summary of the earlier chat")).toBeLessThan(text.indexOf("Recent messages"));
    expect(text.indexOf("ask 0")).toBeLessThan(text.indexOf("ask 1"));
  });

  it("compacts once the chat passes the limit and keeps the newest messages", () => {
    const memory = { summary: "", turns: turns(100) };
    expect(needsCompacting({ summary: "", turns: turns(3) })).toBe(false);
    expect(needsCompacting(memory)).toBe(true);
    const { older, recent } = splitForCompacting(memory);
    expect(older.length + recent.length).toBe(100);
    expect(recent.at(-1)?.prompt).toContain("ask 99");
    expect(recent.length).toBeGreaterThan(0);
    const folded = { summary: plainSummary("", older), turns: recent };
    expect(folded.summary).toContain(`ask ${older.length - 1}`);
    expect(folded.summary.length).toBeLessThanOrEqual(6000);
    expect(needsCompacting(folded)).toBe(false);
    expect(chatContext(folded, older.length)).toMatchObject({ limit: 8000, turns: recent.length, summarized: older.length });
  });
});
