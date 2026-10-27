import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { turnGuard } from "@chef/core";
import { RunnerCoder } from "../../src/local/index.ts";
import { REPO_ROOT } from "../../src/world.ts";

interface Seen {
  readonly path: string;
  readonly key: string;
  readonly model: string;
  readonly tools: readonly string[];
  readonly system: string;
  readonly body: string;
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

const HELLO = "export const hello = () => \"hello\";\n";
const IMAGE = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

type Call = { readonly name: string; readonly input: object };

function fakeClaude(call: Call | ((conversation: string) => Call | null)) {
  const seen: Seen[] = [];
  const puts: { readonly path: string; readonly body: string }[] = [];
  const stored = new Map<string, Buffer>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (req.method === "PUT") {
        puts.push({ path: req.url ?? "", body: raw });
        stored.set(req.url ?? "", Buffer.concat(chunks));
        return void res.writeHead(204).end();
      }
      if (req.method === "GET" && (req.url ?? "").startsWith("/uploads/")) return void (req.url === "/uploads/0123456789abcdef0123.png" ? res.writeHead(200).end(IMAGE) : res.writeHead(404).end());
      if (req.method === "GET" && (req.url ?? "").startsWith("/transcripts/")) {
        const body = stored.get(req.url ?? "");
        return void (body ? res.writeHead(200).end(body) : res.writeHead(404).end());
      }
      const body = (raw ? JSON.parse(raw) : {}) as { model?: string; stream?: boolean; tools?: { name: string }[]; messages?: { content: unknown }[]; system?: unknown };
      const path = (req.url ?? "").split("?")[0] ?? "";
      const tools = (body.tools ?? []).map((t) => t.name);
      seen.push({ path, key: String(req.headers["x-api-key"] ?? req.headers["authorization"] ?? ""), model: body.model ?? "", tools, system: `${JSON.stringify(body.system ?? "")}${JSON.stringify(body.messages ?? [])}`, body: raw });
      if (path.endsWith("/count_tokens")) return void res.end(JSON.stringify({ input_tokens: 12 }));
      if (!path.endsWith("/v1/messages")) return void res.writeHead(404).end();
      const model = body.model ?? "claude";
      const conversation = JSON.stringify(body.messages ?? []);
      const next = typeof call === "function" ? call(conversation) : conversation.includes("tool_result") ? null : call;
      if (tools.includes("Write") && next) return sse(res, model, [{ type: "text", text: "Writing the feature.\n" }, { type: "tool_use", id: `toolu_${conversation.length}`, ...next }], "tool_use");
      const text = tools.includes("Write") ? "Added features/hello/index.ts." : "ok";
      if (body.stream) return sse(res, model, [{ type: "text", text }], "end_turn");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 12, output_tokens: 3 } }));
    });
  });
  return { server, seen, puts, stored };
}

async function runRunner(job: object, cwd: string, workspace: string, home: string): Promise<{ readonly code: number | null; readonly events: ({ type: string } & Record<string, unknown>)[]; readonly err: string }> {
  mkdirSync(cwd, { recursive: true });
  const child = spawn("node", [join(REPO_ROOT, "workers", "sandbox", "runner.mjs")], {
    cwd,
    env: { PATH: process.env["PATH"] ?? "", HOME: home, CHEF_WORKSPACE: workspace, CHEF_JOB: Buffer.from(JSON.stringify(job)).toString("base64") },
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, err, events: out.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string } & Record<string, unknown>) };
}

function origin(dir: string): string {
  mkdirSync(join(dir, "features"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# demo\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=main");
  git("add", "-A");
  git("-c", "user.email=ma.karimi76@gmail.com", "-c", "user.name=chef", "commit", "--quiet", "-m", "init");
  return git("rev-parse", "HEAD");
}

describe("coder runner on the Claude Agent SDK", () => {
  it("runs one turn through the base URL it is given, streams its events and returns the changed files", async () => {
    const root = mkdtempSync(join(tmpdir(), "chef-runner-"));
    const remote = join(root, "origin");
    mkdirSync(remote);
    const commitId = origin(remote);
    const workspace = join(root, "workspace");
    const { server, seen, puts } = fakeClaude({ name: "Write", input: { file_path: join(workspace, "s1", "repo", "features", "hello", "index.ts"), content: HELLO } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const job = {
      sessionId: "s1",
      featureId: "hello",
      role: "backend",
      model: "claude-sonnet-5-5",
      prompt: "Add features/hello/index.ts exporting hello().",
      agent: { name: "chef-backend", displayName: "chef backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default", effort: "low", skills: [{ name: "greeting-style", description: "Use when writing a greeting function", body: "Greetings are lower case." }] },
      writeScope: ["features/hello/**"],
      remote,
      ref: "main",
      commitId,
      llm: { baseUrl: `http://127.0.0.1:${port}` },
      transcripts: `http://127.0.0.1:${port}/transcripts/s1/`,
    };
    try {
      const child = spawn("node", [join(REPO_ROOT, "workers", "sandbox", "runner.mjs")], {
        env: { PATH: process.env["PATH"] ?? "", HOME: root, CHEF_WORKSPACE: workspace, CHEF_JOB: Buffer.from(JSON.stringify(job)).toString("base64") },
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
      expect(events.find((e) => e.type === "tool.execution_start")).toMatchObject({ tool: "Write", detail: "features/hello/index.ts" });
      expect(types.indexOf("session.idle")).toBeLessThan(types.indexOf("chef.result"));
      const result = events.at(-1) as { type: string; changes: Record<string, string | null>; summary: string; model: string };
      expect(result.type).toBe("chef.result");
      expect(result.changes).toEqual({ "features/hello/index.ts": "export const hello = () => \"hello\";\n" });
      expect(result.summary).toBe("Added features/hello/index.ts.");
      const turns = seen.filter((s) => s.tools.includes("Write"));
      expect(turns.length).toBe(2);
      expect(turns.every((s) => s.model === "claude-sonnet-5-5")).toBe(true);
      expect(turns.map((s) => (JSON.parse(s.body) as { output_config?: { effort?: string } }).output_config?.effort)).toEqual(["low", "low"]);
      expect(turns.every((s) => s.tools.includes("Skill"))).toBe(true);
      expect(turns[0]?.system).toContain("greeting-style");
      expect(turns[0]?.system).toContain("Use when writing a greeting function");
      expect(seen.filter((s) => s.path.startsWith("/v1/") && s.key !== "chef-placeholder").map((s) => s.path)).toEqual([]);
      const transcript = puts.find((p) => /^\/transcripts\/s1\/projects\/[^/]+\/[^/]+\.jsonl$/.test(p.path));
      expect(transcript?.body).toContain("features/hello/index.ts");
      const record = JSON.parse(puts.findLast((p) => p.path.startsWith("/transcripts/s1/turns/"))?.body ?? "{}") as Record<string, unknown>;
      expect(record).toMatchObject({ role: "chef-backend", model: "claude-sonnet-5-5", outcome: "done" });
      expect(record["claudeSessions"]).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("continues the saved conversation and changes after the sandbox restarts, and the same role's conversation in a later turn", async () => {
    const root = mkdtempSync(join(tmpdir(), "chef-runner-"));
    const remote = join(root, "origin");
    mkdirSync(remote);
    const commitId = origin(remote);
    const workspace = join(root, "workspace");
    const { server, seen } = fakeClaude({ name: "Write", input: { file_path: join(workspace, "s3", "repo", "features", "hello", "index.ts"), content: HELLO } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const job = {
      sessionId: "s3",
      featureId: "hello",
      role: "backend",
      model: "claude-sonnet-5-5",
      prompt: "Add features/hello/index.ts exporting hello().",
      agent: { name: "chef-backend", displayName: "chef backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default", effort: null, skills: [] },
      writeScope: ["features/hello/**"],
      remote,
      ref: "main",
      commitId,
      llm: { baseUrl: `http://127.0.0.1:${port}` },
      transcripts: `http://127.0.0.1:${port}/transcripts/s3/`,
    };
    const asked = (from: number) => seen.slice(from).filter((s) => s.tools.includes("Write")).map((s) => s.system).join("\n");
    try {
      const first = await runRunner(job, join(root, "turns", "turnA"), workspace, root);
      expect(first.code, first.err.slice(-2000)).toBe(0);

      rmSync(workspace, { recursive: true, force: true });
      const before = seen.length;
      const restarted = await runRunner({ ...job, resume: { turn: "turnA", changes: true } }, join(root, "turns", "turnB"), workspace, root);
      expect(restarted.code, restarted.err.slice(-2000)).toBe(0);
      expect(asked(before)).toContain("The sandbox restarted while you were working on this turn");
      expect(asked(before)).toContain("Writing the feature.");
      expect(asked(before)).toContain("The repository has your file changes");
      expect(restarted.events.at(-1)).toMatchObject({ type: "chef.result", changes: { "features/hello/index.ts": HELLO } });

      const later = seen.length;
      const rework = await runRunner({ ...job, prompt: "Make hello() say hi.", resume: { turn: "turnB", changes: false } }, join(root, "turns", "turnC"), workspace, root);
      expect(rework.code, rework.err.slice(-2000)).toBe(0);
      expect(asked(later)).toContain("This is a new turn on the same feature");
      expect(asked(later)).toContain("Make hello() say hi.");
      expect(asked(later)).toContain("The sandbox restarted while you were working on this turn");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("puts the images attached to the request in the repository for the turn, outside its changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "chef-runner-"));
    const remote = join(root, "origin");
    mkdirSync(remote);
    const commitId = origin(remote);
    const workspace = join(root, "workspace");
    const { server } = fakeClaude({ name: "Write", input: { file_path: join(workspace, "s6", "repo", "features", "hello", "index.ts"), content: HELLO } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const job = {
      sessionId: "s6",
      featureId: "hello",
      role: "backend",
      model: "claude-sonnet-5-5",
      prompt: "Build a landing page.\n\nReference image: uploads/0123456789abcdef0123.png\nReference image: uploads/ffffffffffffffffffff.png",
      agent: { name: "chef-backend", displayName: "chef backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default", effort: null, skills: [] },
      writeScope: ["features/hello/**"],
      remote,
      ref: "main",
      commitId,
      llm: { baseUrl: `http://127.0.0.1:${port}` },
      uploads: `http://127.0.0.1:${port}/uploads`,
    };
    try {
      const run = await runRunner(job, join(root, "turns", "turnA"), workspace, root);
      expect(run.code, run.err.slice(-2000)).toBe(0);
      const repo = join(workspace, "s6", "repo");
      expect(readFileSync(join(repo, "uploads", "0123456789abcdef0123.png"))).toEqual(IMAGE);
      expect(existsSync(join(repo, "uploads", "ffffffffffffffffffff.png"))).toBe(false);
      expect(run.err).toContain("the attached image ffffffffffffffffffff.png could not be fetched (404)");
      expect(run.events.at(-1)).toMatchObject({ type: "chef.result", changes: { "features/hello/index.ts": HELLO } });
      expect(Object.keys(Object(run.events.at(-1)?.["changes"]))).toEqual(["features/hello/index.ts"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("starts a new conversation when the earlier one cannot be found", async () => {
    const root = mkdtempSync(join(tmpdir(), "chef-runner-"));
    const remote = join(root, "origin");
    mkdirSync(remote);
    const commitId = origin(remote);
    const workspace = join(root, "workspace");
    const { server, seen } = fakeClaude({ name: "Write", input: { file_path: join(workspace, "s4", "repo", "features", "hello", "index.ts"), content: HELLO } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const job = {
      sessionId: "s4",
      featureId: "hello",
      role: "backend",
      model: "claude-sonnet-5-5",
      prompt: "Add features/hello/index.ts exporting hello().",
      agent: { name: "chef-backend", displayName: "chef backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default", effort: null, skills: [] },
      writeScope: ["features/hello/**"],
      remote,
      ref: "main",
      commitId,
      llm: { baseUrl: `http://127.0.0.1:${port}` },
      transcripts: `http://127.0.0.1:${port}/transcripts/s4/`,
      resume: { turn: "missing", changes: true },
    };
    try {
      const run = await runRunner(job, join(root, "turns", "turnA"), workspace, root);
      expect(run.code, run.err.slice(-2000)).toBe(0);
      expect(seen.filter((s) => s.tools.includes("Write")).map((s) => s.system).join("\n")).not.toContain("The sandbox restarted");
      expect(run.events.at(-1)).toMatchObject({ type: "chef.result", changes: { "features/hello/index.ts": HELLO } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("drives the same runner as the local Coder, with the real key swapped in", async () => {
    const { server, seen } = fakeClaude({ name: "Bash", input: { command: `mkdir -p features/hello && printf '%s' '${HELLO}' > features/hello/index.ts`, description: "Write the feature" } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const coder = new RunnerCoder({ runner: join(REPO_ROOT, "workers", "sandbox", "runner.mjs"), baseUrl: `http://127.0.0.1:${port}`, apiKey: "local-key", model: "claude-sonnet-5-5" });
    const events: string[] = [];
    try {
      const result = await coder.runTurn({
        sessionId: "s1",
        featureId: "hello",
        role: "backend",
        model: "coder-default",
        prompt: "Add features/hello/index.ts exporting hello().",
        instructions: "",
        writeScope: ["features/hello/**"],
        agent: { name: "chef-backend", displayName: "chef backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default", effort: null, skills: [] },
        attempt: { index: 1, of: 1 },
        workspace: { repo: "demo", remote: "", ref: "main", commitId: "", readToken: "", tree: { "README.md": "# demo\n" } },
        onEvent: (event) => events.push(event.type),
      });
      expect(result.changes).toEqual({ "features/hello/index.ts": "export const hello = () => \"hello\";\n" });
      expect(result.summary).toBe("Added features/hello/index.ts.");
      expect(result.runId).toBe("s1-local-1");
      expect(events).toContain("tool.execution_start");
      expect(seen.filter((s) => s.tools.includes("Write")).every((s) => s.model === "claude-sonnet-5-5")).toBe(true);
      expect(seen.filter((s) => s.path.startsWith("/v1/") && s.key !== "local-key").map((s) => s.path)).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("hands lint problems in its own changes back to the agent before it returns", async () => {
    const write = (content: string): Call => ({ name: "Bash", input: { command: `mkdir -p features/hello && printf '%s' '${content}' > features/hello/index.ts`, description: "Write the feature" } });
    const { server } = fakeClaude((conversation) => {
      const results = conversation.split("tool_result").length - 1;
      if (results === 0) return write("export const hello = () => \"hello\"; // greet\n");
      if (results === 1 && conversation.includes("project lint rejects")) return write(HELLO);
      return null;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const coder = new RunnerCoder({ runner: join(REPO_ROOT, "workers", "sandbox", "runner.mjs"), lint: join(REPO_ROOT, "workers", "sandbox", "lint.mjs"), baseUrl: `http://127.0.0.1:${port}`, apiKey: "local-key", model: "claude-sonnet-5-5" });
    const events: { type: string }[] = [];
    try {
      const result = await coder.runTurn({
        sessionId: "s2",
        featureId: "hello",
        role: "backend",
        model: "coder-default",
        prompt: "Add features/hello/index.ts exporting hello().",
        instructions: "",
        writeScope: ["features/hello/**"],
        agent: { name: "chef-backend", displayName: "chef backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default", effort: null, skills: [] },
        attempt: { index: 1, of: 1 },
        workspace: { repo: "demo", remote: "", ref: "main", commitId: "", readToken: "", tree: { "README.md": "# demo\n" } },
        onEvent: (event) => events.push(event),
      });
      expect(events.filter((e) => e.type === "chef.lint")).toHaveLength(1);
      expect(result.changes).toEqual({ "features/hello/index.ts": HELLO });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses a write outside the role's paths or into a file another role owns before it happens, and says why", async () => {
    const root = mkdtempSync(join(tmpdir(), "chef-runner-"));
    const remote = join(root, "origin");
    mkdirSync(remote);
    const commitId = origin(remote);
    const workspace = join(root, "workspace");
    const repo = join(workspace, "s5", "repo");
    const { server, seen } = fakeClaude((conversation) => {
      const results = conversation.split("tool_result").length - 1;
      if (results === 0) return { name: "Write", input: { file_path: join(repo, "shared", "x.ts"), content: HELLO } };
      if (results === 1) return { name: "Write", input: { file_path: join(repo, "features", "hello", "routes.ts"), content: HELLO } };
      if (results === 2) return { name: "Write", input: { file_path: join(repo, "features", "hello", "index.ts"), content: HELLO } };
      return null;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const job = {
      sessionId: "s5",
      featureId: "hello",
      role: "backend",
      model: "claude-sonnet-5-5",
      prompt: "Add features/hello/index.ts exporting hello().",
      agent: { name: "chef-backend", displayName: "chef backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default", skills: [] },
      writeScope: ["features/hello/**"],
      guard: turnGuard({ scope: ["features/hello/**"], generated: [], locked: [], owned: [["features/hello/routes.ts", "frontend"]], rules: [] }),
      remote,
      ref: "main",
      commitId,
      llm: { baseUrl: `http://127.0.0.1:${port}` },
    };
    try {
      const run = await runRunner(job, join(root, "turns", "turnA"), workspace, root);
      expect(run.code, run.err.slice(-2000)).toBe(0);
      const asked = seen.filter((s) => s.tools.includes("Write")).map((s) => s.system).join("\n");
      expect(asked).toContain("shared/x.ts: This role may change only these paths: features/hello/**.");
      expect(asked).toContain("features/hello/routes.ts belongs to the frontend role in this feature");
      expect(run.events.at(-1)).toMatchObject({ type: "chef.result", changes: { "features/hello/index.ts": HELLO } });
      expect(Object.keys((run.events.at(-1)?.["changes"] ?? {}) as Record<string, string>)).toEqual(["features/hello/index.ts"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("hands lines that break the project's learned rules back to the agent before it returns", async () => {
    const root = mkdtempSync(join(tmpdir(), "chef-runner-"));
    const remote = join(root, "origin");
    mkdirSync(remote);
    const commitId = origin(remote);
    const workspace = join(root, "workspace");
    const write = (content: string): Call => ({ name: "Bash", input: { command: `mkdir -p features/hello && printf '%s' '${content}' > features/hello/index.ts`, description: "Write the feature" } });
    const { server, seen } = fakeClaude((conversation) => {
      const results = conversation.split("tool_result").length - 1;
      if (results === 0) return write("export const hello = () => { console.log(1); return \"hello\"; };\n");
      if (results === 1 && conversation.includes("project lint rejects")) return write(HELLO);
      return null;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const rule = { id: "no-console", message: "Do not log to the console", files: "features/**/*.ts", forbid: "console\\.log", source: "lane-owner", evidence: [] };
    const job = {
      sessionId: "s6",
      featureId: "hello",
      role: "backend",
      model: "claude-sonnet-5-5",
      prompt: "Add features/hello/index.ts exporting hello().",
      agent: { name: "chef-backend", displayName: "chef backend", description: "Implements a feature.", prompt: "Implement the feature.", tools: null, model: "coder-default", skills: [] },
      writeScope: ["features/hello/**"],
      guard: turnGuard({ scope: ["features/hello/**"], generated: [], locked: [], owned: [], rules: [rule] }),
      remote,
      ref: "main",
      commitId,
      llm: { baseUrl: `http://127.0.0.1:${port}` },
    };
    try {
      const run = await runRunner(job, join(root, "turns", "turnA"), workspace, root);
      expect(run.code, run.err.slice(-2000)).toBe(0);
      expect(run.events.filter((e) => e.type === "chef.lint").map((e) => e["problems"])).toEqual(["features/hello/index.ts:1 Do not log to the console [no-console]"]);
      expect(seen.map((s) => s.system).join("\n")).toContain("[no-console]");
      expect(run.events.at(-1)).toMatchObject({ type: "chef.result", changes: { "features/hello/index.ts": HELLO } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
