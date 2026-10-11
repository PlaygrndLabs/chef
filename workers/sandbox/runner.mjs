import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { approveAll, CopilotClient } from "@github/copilot-sdk";

const job = JSON.parse(Buffer.from(process.env.KARGAH_JOB ?? "", "base64").toString("utf8"));
const dir = join("/workspace", job.sessionId, "repo");
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

execFileSync("rm", ["-rf", dir]);
execFileSync("git", ["clone", "--quiet", "--no-tags", "--branch", job.ref, job.remote, dir]);
git("checkout", "--quiet", job.commitId);
git("config", "user.email", "ma.karimi76@gmail.com");
git("config", "user.name", "kargah");

const client = new CopilotClient({ workingDirectory: dir, gitHubToken: process.env.COPILOT_GITHUB_TOKEN ?? "kargah-placeholder", logLevel: "error" });
await client.start();
const session = await client.createSession({
  model: job.model,
  workingDirectory: dir,
  onPermissionRequest: approveAll,
  systemMessage: { mode: "append", content: `${job.instructions}\n\nYou may only change files matching:\n${job.writeScope.join("\n")}` },
});

let summary = "";
const idle = new Promise((resolve, reject) => {
  session.on((event) => {
    if (event.type === "assistant.message_delta") emit({ type: "assistant.message_delta", delta: event.data?.deltaContent ?? "" });
    else if (event.type === "assistant.message") summary = event.data?.content ?? summary;
    else if (event.type === "tool.execution_start") emit({ type: "tool.execution_start", tool: event.data?.toolName ?? "tool" });
    else if (event.type === "session.error") reject(new Error(event.data?.message ?? "session error"));
    else if (event.type === "session.idle") resolve();
  });
});

await session.send({ prompt: job.prompt });
await idle;
emit({ type: "session.idle" });

git("add", "-A");
const changes = {};
for (const line of git("diff", "--cached", "--name-status", "--no-renames", job.commitId).split("\n").filter(Boolean)) {
  const [status, path] = line.split("\t");
  changes[path] = status === "D" ? null : readFileSync(join(dir, path), "utf8");
}
emit({ type: "kargah.result", changes, summary, model: job.model });
await session.disconnect();
await client.stop();
