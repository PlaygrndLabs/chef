import { describe, expect, it } from "vitest";
import { serve, TODO_PROMPT } from "../../src/serve.ts";

interface Frame {
  readonly type: string;
  readonly [key: string]: unknown;
}

async function runAgent(url: string, prompt: string): Promise<Frame[]> {
  const response = await fetch(`${url}/api/projects/shop/copilotkit/agent/default/run`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ threadId: "t1", runId: "r1", messages: [{ id: "m1", role: "user", content: prompt }], tools: [], context: [], state: {}, forwardedProps: {} }),
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Frame);
}

describe("CopilotKit runtime streams Chef sessions", () => {
  it("routes a chat message, streams the session as AG-UI events and finishes when it merges", async () => {
    const local = await serve({ port: 0, project: "shop", real: false });
    try {
      const frames = await runAgent(local.url, TODO_PROMPT);
      const types = frames.map((f) => f.type);
      expect(types[0]).toBe("RUN_STARTED");
      expect(types.at(-1)).toBe("RUN_FINISHED");
      const text = frames.filter((f) => f.type === "TEXT_MESSAGE_CONTENT").map((f) => f["delta"]).join("");
      expect(text).toContain("Routed as new feature for todo-add");
      expect(text).toContain("editing features/todo-add/");
      expect(text).toMatch(/merged into main as [0-9a-f]{12}/);
      expect(types).toContain("TOOL_CALL_START");
      const steps = frames.filter((f) => f.type === "STEP_STARTED").map((f) => String(f["stepName"]).split(":")[1]);
      expect(steps).toEqual(expect.arrayContaining(["testing", "coding", "reviewing", "gating", "merged"]));
      const last = frames.filter((f) => f.type === "STATE_SNAPSHOT").at(-1)?.["snapshot"] as { sessions: Record<string, { state: string; merged: string | null }> };
      const sessions = Object.values(last.sessions);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.state).toBe("merged");
      expect(sessions[0]?.merged).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await local.close();
    }
  });

  it("answers an empty message without starting a session", async () => {
    const local = await serve({ port: 0, project: "shop", real: false });
    try {
      const frames = await runAgent(local.url, "   ");
      expect(frames.map((f) => f.type)).toEqual(["RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "RUN_FINISHED"]);
      const sessions = (await (await fetch(`${local.url}/api/projects/shop/sessions`)).json()) as unknown[];
      expect(sessions).toEqual([]);
    } finally {
      await local.close();
    }
  });
});
