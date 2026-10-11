import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const job = JSON.parse(Buffer.from(process.env.KARGAH_JOB ?? "", "base64").toString("utf8"));
const dir = join("/workspace", `${job.sessionId}-checks`, "repo");

execFileSync("rm", ["-rf", dir]);
execFileSync("git", ["clone", "--quiet", "--no-tags", "--branch", job.ref, job.remote, dir]);
execFileSync("git", ["checkout", "--quiet", job.commitId], { cwd: dir });
if (!existsSync(join(dir, "node_modules"))) symlinkSync("/opt/kargah/template/node_modules", join(dir, "node_modules"), "dir");

const results = [];
for (const command of job.commands) {
  const run = spawnSync(command.argv[0], command.argv.slice(1), { cwd: dir, encoding: "utf8", timeout: command.timeoutMs ?? 300000, maxBuffer: 16 * 1024 * 1024 });
  results.push({ name: command.name, code: run.status ?? 1, stdout: run.stdout.slice(-20000), stderr: run.stderr.slice(-20000) });
}
process.stdout.write(`${JSON.stringify({ type: "kargah.checks", results })}\n`);
