import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/world.ts";

interface Seen {
  readonly path: string;
  readonly key: string;
  readonly model: string;
  readonly tools: readonly string[];
}

type Block = { readonly type: "text"; readonly text: string } | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: object };

function sse(res: ServerResponse, model: string, blocks: readonly Block[], stop: string): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (data: { type: string } & Record<string, unknown>) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
  send({ type: "message_start", message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } });
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      send({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      send({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else {
      send({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send({ type: "content_block_stop", index });
  });
  send({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 7 } });
  send({ type: "message_stop" });
  res.end();
}

function fakeClaude(target: string) {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      const body = (raw ? JSON.parse(raw) : {}) as { model?: string; stream?: boolean; tools?: { name: string }[]; messages?: { content: unknown }[] };
      const path = (req.url ?? "").split("?")[0] ?? "";
      const tools = (body.tools ?? []).map((t) => t.name);
      seen.push({ path, key: String(req.headers["x-api-key"] ?? req.headers["authorization"] ?? ""), model: body.model ?? "", tools });
      if (path.endsWith("/count_tokens")) return void res.end(JSON.stringify({ input_tokens: 12 }));
      if (!path.endsWith("/v1/messages")) return void res.writeHead(404).end();
      const model = body.model ?? "claude";
      const answered = JSON.stringify(body.messages ?? []).includes("tool_result");
      if (tools.includes("Write") && !answered) return sse(res, model, [{ type: "text", text: "Writing the feature.\n" }, { type: "tool_use", id: "toolu_01", name: "Write", input: { file_path: target, content: "export const hello = () => \"hello\";\n" } }], "tool_use");
      const text = tools.includes("Write") ? "Added features/hello/index.ts." : "ok";
      if (body.stream) return sse(res, model, [{ type: "text", text }], "end_turn");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 12, output_tokens: 3 } }));
    });
  });
  return { server, seen };
}

function origin(dir: string): string {
  mkdirSync(join(dir, "features"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# demo\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=main");
  git("add", "-A");
  git("-c", "user.email=ma.karimi76@gmail.com", "-c", "user.name=kargah", "commit", "--quiet", "-m", "init");
  return git("rev-parse", "HEAD");
}

describe("coder runner on the Claude Agent SDK", () => {
  it("runs one turn through the base URL it is given, streams its events and returns the changed files", async () => {
    const root = mkdtempSync(join(tmpdir(), "kargah-runner-"));
    const remote = join(root, "origin");
    mkdirSync(remote);
    const commitId = origin(remote);
    const workspace = join(root, "workspace");
    const { server, seen } = fakeClaude(join(workspace, "s1", "repo", "features", "hello", "index.ts"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const job = {
      sessionId: "s1",
      featureId: "hello",
      role: "backend",
      model: "claude-sonnet-5-5",
      prompt: "Add features/hello/index.ts exporting hello().",
      agent: { name: "kargah-backend", displayName: "kargah backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default" },
      writeScope: ["features/hello/**"],
      remote,
      ref: "main",
      commitId,
      llm: { baseUrl: `http://127.0.0.1:${port}` },
    };
    try {
      const child = spawn("node", [join(REPO_ROOT, "workers", "sandbox", "runner.mjs")], {
        env: { PATH: process.env["PATH"] ?? "", HOME: root, KARGAH_WORKSPACE: workspace, KARGAH_JOB: Buffer.from(JSON.stringify(job)).toString("base64") },
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
      const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
      expect(code, err.slice(-2000)).toBe(0);
      const events = out.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string } & Record<string, unknown>);
      const types = events.map((e) => e.type);
      expect(types).toContain("assistant.message_delta");
      expect(events.find((e) => e.type === "tool.execution_start")?.["tool"]).toBe("Write");
      expect(types.indexOf("session.idle")).toBeLessThan(types.indexOf("kargah.result"));
      const result = events.at(-1) as { type: string; changes: Record<string, string | null>; summary: string; model: string };
      expect(result.type).toBe("kargah.result");
      expect(result.changes).toEqual({ "features/hello/index.ts": "export const hello = () => \"hello\";\n" });
      expect(result.summary).toBe("Added features/hello/index.ts.");
      const turns = seen.filter((s) => s.tools.includes("Write"));
      expect(turns.length).toBe(2);
      expect(turns.every((s) => s.model === "claude-sonnet-5-5")).toBe(true);
      expect(seen.filter((s) => s.path.startsWith("/v1/") && s.key !== "kargah-placeholder").map((s) => s.path)).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
