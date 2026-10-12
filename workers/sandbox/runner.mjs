import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, symlinkSync } from "node:fs";
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
const modules = process.env.KARGAH_NODE_MODULES ?? "/opt/kargah/template/node_modules";
if (existsSync(modules) && !existsSync(join(dir, "node_modules"))) {
  symlinkSync(modules, join(dir, "node_modules"), "dir");
  appendFileSync(join(dir, ".git", "info", "exclude"), "\nnode_modules\n");
}

const env = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "/tmp",
  ANTHROPIC_BASE_URL: job.llm.baseUrl,
  ANTHROPIC_API_KEY: process.env.KARGAH_LLM_KEY ?? "kargah-placeholder",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_AUTOUPDATER: "1",
};
for (const name of ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) if (process.env[name]) env[name] = process.env[name];

const lint = process.env.KARGAH_LINT ?? "/opt/kargah/template/lint.mjs";
const options = (resume) => ({
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
  ...(resume ? { resume } : {}),
});

async function turn(prompt, resume) {
  let result = null;
  for await (const message of query({ prompt, options: options(resume) })) {
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
  return result;
}

function changedPaths() {
  git("add", "-A");
  return git("diff", "--cached", "--name-only", "--no-renames", "--diff-filter=AM", job.commitId).split("\n").filter(Boolean);
}

function lintProblems() {
  if (!existsSync(lint)) return "";
  const paths = changedPaths();
  if (paths.length === 0) return "";
  const run = spawnSync("node", [lint, ...paths], { cwd: dir, encoding: "utf8" });
  return run.status === 0 ? "" : run.stdout.trim();
}

let result = await turn(job.prompt);
const usage = { ...result.usage };
for (let round = 0; round < 2; round++) {
  const problems = lintProblems();
  if (!problems) break;
  emit({ type: "kargah.lint", problems });
  result = await turn(`The project lint rejects your changes. Fix every problem below in the files you changed, without adding comments, then stop.\n\n${problems}`, result.session_id);
  for (const key of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) usage[key] = (usage[key] ?? 0) + (result.usage[key] ?? 0);
}
emit({ type: "session.idle" });

git("add", "-A");
const changes = {};
for (const line of git("diff", "--cached", "--name-status", "--no-renames", job.commitId).split("\n").filter(Boolean)) {
  const [status, path] = line.split("\t");
  changes[path] = status === "D" ? null : readFileSync(join(dir, path), "utf8");
}
emit({ type: "kargah.result", changes, summary: result.result, model: job.model, usage: { inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), outputTokens: usage.output_tokens } });
