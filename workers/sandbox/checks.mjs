import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const job = JSON.parse(Buffer.from(process.env.CHEF_JOB ?? "", "base64").toString("utf8"));
const dir = join("/workspace", `${job.sessionId}-checks`, "repo");

function setup(argv, options = {}) {
  try {
    execFileSync(argv[0], argv.slice(1), { ...options, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    process.stderr.write(`${argv.slice(0, 2).join(" ")} failed: ${String(error.stderr || error.message).trim()}\n`);
    process.exit(1);
  }
}

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

setup(["rm", "-rf", dir]);
clone(dir);
setup(["git", "checkout", "--quiet", job.commitId], { cwd: dir });
for (const [path, content] of Object.entries(job.overlay ?? {})) {
  const target = join(dir, path);
  if (content === null) rmSync(target, { force: true });
  else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
if (!existsSync(join(dir, "node_modules"))) symlinkSync("/opt/chef/template/node_modules", join(dir, "node_modules"), "dir");

const results = [];
for (const command of job.commands) {
  const run = spawnSync(command.argv[0], command.argv.slice(1), { cwd: dir, encoding: "utf8", timeout: command.timeoutMs ?? 300000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...command.env } });
  const stderr = `${run.stderr ?? ""}${run.error ? `\n${command.argv[0]} failed: ${run.error.message}` : ""}`;
  results.push({ name: command.name, code: run.status ?? 1, stdout: (run.stdout ?? "").slice(-20000), stderr: stderr.slice(-20000) });
}
process.stdout.write(`${JSON.stringify({ type: "chef.checks", results })}\n`);
