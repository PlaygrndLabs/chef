import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

const job = JSON.parse(Buffer.from(process.env.KARGAH_JOB ?? "", "base64").toString("utf8"));
const dir = join(process.env.KARGAH_WORKSPACE ?? "/workspace", job.sessionId, "repo");
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

execFileSync("rm", ["-rf", dir]);
execFileSync("git", ["clone", "--quiet", "--no-tags", "--branch", job.ref, job.remote, dir]);
git("checkout", "--quiet", job.commitId);
git("config", "user.email", "ma.karimi76@gmail.com");
git("config", "user.name", "kargah");

const env = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "/tmp",
  ANTHROPIC_BASE_URL: job.llm.baseUrl,
  ANTHROPIC_API_KEY: "kargah-placeholder",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_AUTOUPDATER: "1",
};
for (const name of ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) if (process.env[name]) env[name] = process.env[name];

const session = query({
  prompt: job.prompt,
  options: {
    cwd: dir,
    model: job.model,
    agents: { [job.agent.name]: { description: job.agent.description, prompt: job.agent.prompt, ...(job.agent.tools ? { tools: [...job.agent.tools] } : {}) } },
    agent: job.agent.name,
    canUseTool: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
    disallowedTools: ["WebFetch", "WebSearch"],
    settingSources: [],
    includePartialMessages: true,
    maxTurns: job.maxTurns ?? 60,
    env,
    stderr: (data) => process.stderr.write(data),
  },
});

let result = null;
for await (const message of session) {
  if (message.type === "stream_event" && message.parent_tool_use_id === null) {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") emit({ type: "assistant.message_delta", delta: event.delta.text });
    else if (event.type === "content_block_start" && event.content_block.type === "tool_use") emit({ type: "tool.execution_start", tool: event.content_block.name });
  } else if (message.type === "result") result = message;
}
if (!result || result.subtype !== "success" || result.is_error) {
  emit({ type: "session.error", message: result ? `${result.subtype}${result.result ? `: ${result.result}` : ""}` : "the coder ended without a result" });
  process.exit(1);
}
emit({ type: "session.idle" });

git("add", "-A");
const changes = {};
for (const line of git("diff", "--cached", "--name-status", "--no-renames", job.commitId).split("\n").filter(Boolean)) {
  const [status, path] = line.split("\t");
  changes[path] = status === "D" ? null : readFileSync(join(dir, path), "utf8");
}
emit({ type: "kargah.result", changes, summary: result.result, model: job.model, usage: { inputTokens: result.usage.input_tokens + (result.usage.cache_read_input_tokens ?? 0) + (result.usage.cache_creation_input_tokens ?? 0), outputTokens: result.usage.output_tokens } });
