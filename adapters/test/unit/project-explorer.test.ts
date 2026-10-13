import { describe, expect, it } from "vitest";
import { llmFromEnv } from "../../src/anthropic.ts";
import { digest, exploreProject } from "../../src/project-explorer.ts";

const tree = {
  "README.md": "# Nocheh\nA memory assistant you talk to on Telegram.",
  "TODO.md": "- first reply is slow\n- recall misses old notes",
  "package.json": JSON.stringify({ name: "nocheh" }),
  "src/bot.ts": "export const bot = 1;",
  "node_modules/x/index.js": "ignored",
  "docs/setup.md": "How to run it",
  "docs/deep/notes.md": "too deep",
  "logo.png": "",
};

describe("reading an imported project", () => {
  it("lists the code but reads only the files that say what the project is", () => {
    const { paths, files } = digest(tree);
    expect(paths).not.toContain("node_modules/x/index.js");
    expect(paths).toContain("src/bot.ts");
    expect(files.map((f) => f.path)).toEqual(["README.md", "TODO.md", "package.json", "docs/setup.md"]);
  });

  it("asks the model for a summary, problems and three first tasks", async () => {
    const seen: string[] = [];
    const reply = { summary: " Nocheh remembers what you tell it. ", problems: ["Slow first reply", "Recall misses", "a", "b", "c"], suggestions: [1, 2, 3, 4].map((n) => ({ title: `Task ${n}`, why: "w", prompt: `do ${n}` })) };
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      seen.push(body.messages[0]?.content ?? "");
      const message = { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const llm = llmFromEnv({ LLM_BASE_URL: "http://127.0.0.1:1/", LLM_API_KEY: "k" }, fetchImpl);
    const overview = await exploreProject(llm, { name: "nocheh", tree });
    expect(overview.summary).toBe("Nocheh remembers what you tell it.");
    expect(overview.problems).toHaveLength(4);
    expect(overview.suggestions.map((s) => s.title)).toEqual(["Task 1", "Task 2", "Task 3"]);
    expect(seen[0]).toContain("### TODO.md\n- first reply is slow");
    expect(seen[0]).toContain("src/bot.ts");
  });
});
