import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { query } from "@anthropic-ai/claude-agent-sdk";

const job = JSON.parse(Buffer.from(process.env.CHEF_JOB ?? "", "base64").toString("utf8"));
const dir = join(process.env.CHEF_WORKSPACE ?? "/workspace", job.sessionId, "repo");
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const INSTALLED_DIRS = ["node_modules", ".pnpm-store", ".yarn/cache", "__pycache__", ".venv"];
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function clone(target) {
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync("git", ["clone", "--quiet", "--no-tags", "--branch", job.ref, job.remote, target], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return;
    } catch (error) {
      rmSync(target, { recursive: true, force: true });
      if (attempt >= 3) {
        process.stderr.write(`git clone failed: ${String(error.stderr || error.message).trim()}\n`);
        process.exit(1);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 * 4 ** (attempt - 1));
    }
  }
}

if (existsSync(join(dir, ".git"))) {
  git("fetch", "--quiet", "--no-tags", job.remote, job.ref);
  git("reset", "--quiet", "--hard", job.commitId);
  git("clean", "--quiet", "-fd");
} else {
  execFileSync("rm", ["-rf", dir]);
  clone(dir);
  git("checkout", "--quiet", job.commitId);
}
git("config", "user.email", "ma.karimi76@gmail.com");
git("config", "user.name", "chef");
const exclude = join(dir, ".git", "info", "exclude");
const excluded = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
const installed = INSTALLED_DIRS.filter((name) => !excluded.split("\n").includes(name));
if (installed.length) appendFileSync(exclude, `\n${installed.join("\n")}\n`);
const modules = process.env.CHEF_NODE_MODULES ?? "/opt/chef/template/node_modules";
if (!job.ownStructure && existsSync(modules) && !existsSync(join(dir, "node_modules"))) symlinkSync(modules, join(dir, "node_modules"), "dir");

const env = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "/tmp",
  CLAUDE_CONFIG_DIR: join(dir, "..", "claude"),
  ANTHROPIC_BASE_URL: job.llm.baseUrl,
  ANTHROPIC_API_KEY: process.env.CHEF_LLM_KEY ?? "chef-placeholder",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_AUTOUPDATER: "1",
};
for (const name of ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "PLAYWRIGHT_BROWSERS_PATH", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"]) if (process.env[name]) env[name] = process.env[name];

const skills = job.agent.skills ?? [];
const skillsDir = join(env.CLAUDE_CONFIG_DIR, "skills");
rmSync(skillsDir, { recursive: true, force: true });
for (const skill of skills) {
  mkdirSync(join(skillsDir, skill.name), { recursive: true });
  writeFileSync(join(skillsDir, skill.name, "SKILL.md"), `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body}\n`);
}
const skillNames = skills.map((skill) => skill.name);

const claudeProjects = join(env.CLAUDE_CONFIG_DIR, "projects");
const savedMarks = join(env.CLAUDE_CONFIG_DIR, "saved.json");
const records = join(env.CLAUDE_CONFIG_DIR, "turns");
const record = { turn: basename(process.cwd()), role: job.agent.name, model: job.model, claudeSessions: [], claudeSession: null, transcript: null, resumedFrom: job.resume?.turn ?? null, startedAt: new Date().toISOString(), endedAt: null, outcome: null };
let saving = Promise.resolve();
let queued = false;

function files(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(root, entry.name)) : entry.isFile() ? [join(root, entry.name)] : []));
}

const transcriptUrl = (path) => `${job.transcripts}${path.split("/").map(encodeURIComponent).join("/")}`;

async function put(path, body) {
  const response = await fetch(transcriptUrl(path), { method: "PUT", body }).catch(() => null);
  return response?.ok === true;
}

async function get(path) {
  if (!job.transcripts) return null;
  const response = await fetch(transcriptUrl(path)).catch(() => null);
  return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
}

function workPatch() {
  const index = join(env.CLAUDE_CONFIG_DIR, "work.index");
  const run = (...args) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_INDEX_FILE: index }, maxBuffer: 64 * 1024 * 1024 });
  run("read-tree", job.commitId);
  run("add", "-A");
  return run("diff", "--cached", "--binary", job.commitId);
}

function writeRecord() {
  if (record.claudeSession) {
    const transcript = files(claudeProjects).find((file) => basename(file) === `${record.claudeSession}.jsonl`);
    if (transcript) record.transcript = relative(env.CLAUDE_CONFIG_DIR, transcript);
  }
  mkdirSync(records, { recursive: true });
  writeFileSync(join(records, `${record.turn}.json`), JSON.stringify(record, null, 2));
}

async function saveTranscripts() {
  const marks = existsSync(savedMarks) ? JSON.parse(readFileSync(savedMarks, "utf8")) : {};
  for (const file of files(claudeProjects)) {
    const stat = statSync(file);
    const mark = `${stat.size}:${stat.mtimeMs}`;
    const path = relative(env.CLAUDE_CONFIG_DIR, file);
    if (marks[path] !== mark && (await put(path, readFileSync(file)))) marks[path] = mark;
  }
  writeFileSync(savedMarks, JSON.stringify(marks));
  try {
    await put(`turns/${record.turn}.patch`, workPatch());
  } catch (error) {
    process.stderr.write(`saving the turn's changes failed: ${error.message}\n`);
  }
  await put(`turns/${record.turn}.json`, JSON.stringify(record, null, 2));
}

function save() {
  writeRecord();
  if (!job.transcripts || queued) return saving;
  queued = true;
  saving = saving
    .then(() => {
      queued = false;
      return saveTranscripts();
    })
    .catch((error) => process.stderr.write(`saving the transcript failed: ${error.message}\n`));
  return saving;
}

async function earlierConversation() {
  if (!job.resume) return null;
  const local = join(records, `${job.resume.turn}.json`);
  const text = existsSync(local) ? readFileSync(local, "utf8") : (await get(`turns/${job.resume.turn}.json`))?.toString("utf8");
  let before;
  try {
    before = text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
  if (!before?.claudeSession || !before.transcript) return null;
  const transcript = join(env.CLAUDE_CONFIG_DIR, before.transcript);
  if (!existsSync(transcript)) {
    const body = await get(before.transcript);
    const end = body ? body.lastIndexOf(10) : -1;
    if (end < 0) return null;
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, body.subarray(0, end + 1));
  }
  if (!job.resume.changes) return { session: before.claudeSession, prompt: `This is a new turn on the same feature, and your earlier turn is above. The repository is now at the latest commit, which can include changes other roles made since then, so read files again before you change them.\n\n${job.prompt}` };
  const patch = await get(`turns/${job.resume.turn}.patch`);
  let restored = patch !== null;
  if (patch?.length) {
    const file = join(env.CLAUDE_CONFIG_DIR, "work.patch");
    writeFileSync(file, patch);
    restored = spawnSync("git", ["apply", "--binary", "--whitespace=nowarn", file], { cwd: dir }).status === 0;
    if (!restored) git("reset", "--quiet", "--hard", job.commitId);
  }
  const state = restored ? "The repository has your file changes as they were at the last save, up to fifteen seconds before the restart, so check git status and git diff before you go on." : "Your file changes from this turn were lost, so the repository is back where the turn started and you need to redo them.";
  return { session: before.claudeSession, prompt: `The sandbox restarted while you were working on this turn, so you continue from your saved conversation. ${state} Then finish the task you were given.` };
}

async function finish(outcome, code) {
  record.endedAt = new Date().toISOString();
  record.outcome = outcome;
  clearInterval(saver);
  await save();
  process.exit(code);
}

const saver = setInterval(save, 15_000);

const lint = process.env.CHEF_LINT ?? "/opt/chef/template/lint.mjs";
const guard = job.guard ?? null;
const compiled = (sources) => (sources ?? []).map((source) => new RegExp(source));
const allowed = compiled(guard?.allow);
const denied = compiled(guard?.deny);
const rules = (guard?.rules ?? []).map((rule) => ({ ...rule, files: new RegExp(rule.files), forbid: new RegExp(rule.forbid) }));

function blocked(file) {
  if (!guard || typeof file !== "string") return null;
  const path = relative(dir, resolve(dir, file));
  if (path.startsWith("..") || isAbsolute(path)) return null;
  if (guard.blocked[path]) return guard.blocked[path];
  if (guard.free.includes(path)) return null;
  if (denied.some((regex) => regex.test(path)) || !allowed.some((regex) => regex.test(path))) return `${path}: ${guard.scope}`;
  return null;
}

const writeGuard = async (input) => {
  const reason = blocked(input.tool_input?.file_path ?? input.tool_input?.notebook_path);
  return reason ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } } : {};
};

const options = (resume) => ({
  cwd: dir,
  model: job.model,
  agents: { [job.agent.name]: { description: job.agent.description, prompt: job.agent.prompt, ...(job.agent.tools ? { tools: [...job.agent.tools] } : {}), ...(skillNames.length ? { skills: skillNames } : {}) } },
  agent: job.agent.name,
  canUseTool: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
  disallowedTools: ["WebFetch", "WebSearch"],
  settingSources: skillNames.length ? ["user"] : [],
  ...(skillNames.length ? { skills: skillNames } : {}),
  includePartialMessages: true,
  maxTurns: job.maxTurns ?? 60,
  ...(guard ? { hooks: { PreToolUse: [{ matcher: "Write|Edit|NotebookEdit", hooks: [writeGuard] }] } } : {}),
  env,
  stderr: (data) => process.stderr.write(data),
  ...(resume ? { resume } : {}),
});

function toolDetail(input) {
  const value = input?.file_path ?? input?.command ?? input?.pattern ?? input?.path ?? input?.description ?? "";
  const text = String(value).replaceAll(`${dir}/`, "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

async function turn(prompt, resume) {
  let result = null;
  for await (const message of query({ prompt, options: options(resume) })) {
    if (message.session_id) {
      record.claudeSession = message.session_id;
      if (!record.claudeSessions.includes(message.session_id)) record.claudeSessions.push(message.session_id);
    }
    if (message.type === "stream_event" && message.parent_tool_use_id === null) {
      const event = message.event;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") emit({ type: "assistant.message_delta", delta: event.delta.text });
    } else if (message.type === "assistant" && message.parent_tool_use_id === null) {
      for (const block of message.message.content ?? []) if (block.type === "tool_use") emit({ type: "tool.execution_start", tool: block.name, detail: toolDetail(block.input) });
    } else if (message.type === "result") result = message;
  }
  if (!result || result.subtype !== "success" || result.is_error) {
    const message = result ? `${result.subtype}${result.result ? `: ${result.result}` : ""}` : "the coder ended without a result";
    emit({ type: "session.error", message });
    await finish(message, 1);
  }
  return result;
}

function changedPaths() {
  git("add", "-A");
  return git("diff", "--cached", "--name-only", "--no-renames", "--diff-filter=AM", job.commitId).split("\n").filter(Boolean);
}

function ruleProblems(paths) {
  const problems = [];
  for (const path of paths) {
    if (path.startsWith(guard.rulesDir) || guard.free.includes(path)) continue;
    const matching = rules.filter((rule) => rule.files.test(path));
    if (matching.length === 0) continue;
    readFileSync(join(dir, path), "utf8").split("\n").forEach((line, index) => {
      for (const rule of matching) if (rule.forbid.test(line)) problems.push(`${path}:${index + 1} ${rule.message} [${rule.id}]`);
    });
  }
  return problems.join("\n");
}

function lintProblems() {
  const template = !job.ownStructure && existsSync(lint);
  if (!template && rules.length === 0) return "";
  const paths = changedPaths();
  if (paths.length === 0) return "";
  const run = template ? spawnSync("node", [lint, ...paths], { cwd: dir, encoding: "utf8" }) : null;
  return [run && run.status !== 0 ? run.stdout.trim() : "", rules.length ? ruleProblems(paths) : ""].filter(Boolean).join("\n");
}

const earlier = await earlierConversation().catch((error) => {
  process.stderr.write(`the earlier conversation could not be restored: ${error.message}\n`);
  return null;
});
let result = earlier ? await turn(earlier.prompt, earlier.session).catch((error) => {
  process.stderr.write(`resuming the earlier conversation failed, so the turn starts a new one: ${error.message}\n`);
  git("reset", "--quiet", "--hard", job.commitId);
  git("clean", "--quiet", "-fd");
  return null;
}) : null;
result ??= await turn(job.prompt);
const usage = { ...result.usage };
for (let round = 0; round < 2; round++) {
  const problems = lintProblems();
  if (!problems) break;
  emit({ type: "chef.lint", problems });
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
emit({ type: "chef.result", changes, summary: result.result, model: job.model, usage: { inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), outputTokens: usage.output_tokens, cachedInputTokens: usage.cache_read_input_tokens ?? 0 } });
await finish("done", 0);
