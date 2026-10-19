import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const job = process.env.CHEF_JOB ? JSON.parse(Buffer.from(process.env.CHEF_JOB, "base64").toString("utf8")) : {};
const home = join(process.env.CHEF_WORKSPACE ?? "/workspace", job.target ?? "none");
const dir = join(home, "app");
const emit = (event) => process.stdout.write(`${JSON.stringify({ type: "chef.app", ...event })}\n`);
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
const dockerEnv = { ...process.env, COMPOSE_BAKE: "false", DOCKER_BUILDKIT: "1" };
const WRANGLER_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];
const WORKER_PORT = 8787;
const TEMPLATE_DEPS = process.env.CHEF_TEMPLATE_DIR ?? "/opt/chef/template";
const pidFile = join(home, "app.pid");
const logFile = join(home, "app.log");

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const START_SECONDS = 600;
const PORT_SECONDS = 240;
const POLL_MS = 2000;
const LOG_GRACE_MS = 10_000;
const deadline = Date.now() + (job.startSeconds ?? START_SECONDS) * 1000;
const BUILD_ERRORS = [/\[ERROR\]/, /\bbuild failed\b/i, /\bfailed to compile\b/i, /\bcompilation failed\b/i, /\berror during build\b/i, /\bapp crashed\b.*\bwaiting for file changes\b/i, /\bfailed running\b.*\bwaiting for file changes\b/i];

function tail(text, lines = 30) {
  return String(text ?? "").replace(ANSI, "").trim().split("\n").slice(-lines).join("\n");
}

function run(argv, options = {}) {
  const timeout = options.bounded === false ? (options.timeoutMs ?? 900_000) : Math.max(1000, Math.min(options.timeoutMs ?? 900_000, deadline - Date.now()));
  const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout, cwd: options.cwd ?? dir, env: options.env ?? process.env });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return { code: result.status ?? 1, stdout: result.stdout ?? "", timedOut, out: `${result.stdout ?? ""}${result.stderr ?? ""}${timedOut ? `\nstopped after ${Math.round(timeout / 1000)} seconds` : result.error ? `\n${result.error.message}` : ""}` };
}

function fail(step, out) {
  emit({ status: "failed", error: `${step}: ${tail(out) || "no output"}` });
  process.exit(0);
}

function git(...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function syncWorkingCopy() {
  if (job.keep && existsSync(join(dir, ".git"))) return;
  if (existsSync(join(dir, ".git"))) {
    const fetched = run(["git", "fetch", "--quiet", "--no-tags", job.remote, job.ref]);
    if (fetched.code !== 0) fail("fetching the code", fetched.out);
    git("reset", "--quiet", "--hard", job.commitId);
    git("clean", "--quiet", "-fd");
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const cloned = run(["git", "clone", "--quiet", "--no-tags", "--branch", job.ref, job.remote, dir], { cwd: home });
  if (cloned.code !== 0) fail("getting the code", cloned.out);
  git("checkout", "--quiet", job.commitId);
}

export function composeFile(root) {
  return COMPOSE_FILES.find((file) => existsSync(join(root, file))) ?? null;
}

export function wranglerFile(root) {
  return WRANGLER_FILES.find((file) => existsSync(join(root, file))) ?? null;
}

export function coveredBy(wanted, have) {
  const all = (pkg) => ({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) });
  const needed = all(wanted);
  const present = all(have);
  return Object.entries(needed).every(([name, version]) => present[name] === version);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function stopWorker() {
  const pid = Number(readJson(pidFile));
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  rmSync(pidFile, { force: true });
}

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function prepareModules() {
  const pkg = readJson(join(dir, "package.json"));
  if (!pkg) return;
  const modules = join(dir, "node_modules");
  const shared = join(TEMPLATE_DEPS, "node_modules");
  if (existsSync(shared) && coveredBy(pkg, readJson(join(TEMPLATE_DEPS, "package.json")))) {
    if (!isLink(modules)) {
      rmSync(modules, { recursive: true, force: true });
      symlinkSync(shared, modules);
    }
    return;
  }
  const lock = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].map((file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : "")).join("\n");
  const key = createHash("sha256").update(JSON.stringify(pkg)).update(lock).digest("hex");
  const marker = join(home, "modules.key");
  if (existsSync(modules) && !isLink(modules) && existsSync(marker) && readFileSync(marker, "utf8") === key) return;
  if (isLink(modules)) rmSync(modules, { force: true });
  const installed = run(existsSync(join(dir, "package-lock.json")) ? ["npm", "ci", "--no-audit", "--no-fund"] : ["npm", "install", "--no-audit", "--no-fund"], { env: { ...process.env, CI: "true" }, timeoutMs: 900_000 });
  if (installed.code !== 0) fail(installed.timedOut ? `installing the packages did not finish within ${job.startSeconds ?? START_SECONDS} seconds` : "installing the packages", installed.out);
  writeFileSync(marker, key);
}

function logTail(lines = 40) {
  return existsSync(logFile) ? tail(readFileSync(logFile, "utf8"), lines) : "";
}

async function runWorker(file) {
  prepareModules();
  const vars = Object.entries(job.env ?? {}).map(([name, value]) => `${name}=${JSON.stringify(String(value))}`).join("\n");
  writeFileSync(join(dir, ".dev.vars"), vars ? `${vars}\n` : "", { mode: 0o600 });
  emit({ status: "starting", port: WORKER_PORT, commitId: job.commitId });
  const local = join(dir, "node_modules", ".bin", "wrangler");
  const argv = existsSync(local) ? [local] : ["npx", "--yes", "wrangler"];
  const out = openSync(logFile, "w");
  const child = spawn(argv[0], [...argv.slice(1), "dev", "--config", file, "--ip", "0.0.0.0", "--port", String(WORKER_PORT), "--show-interactive-dev-session=false"], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
  });
  writeFileSync(pidFile, JSON.stringify(child.pid));
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = signal ? `was stopped by ${signal}` : `stopped with exit code ${code}`;
  });
  child.unref();
  const from = Date.now();
  const until = Math.min(deadline, from + (job.waitSeconds ?? PORT_SECONDS) * 1000);
  let suspect = null;
  for (;;) {
    if (await answers(WORKER_PORT)) {
      emit({ status: "running", port: WORKER_PORT, commitId: job.commitId });
      process.exit(0);
    }
    if (exited) fail(`the app did not start: wrangler dev ${exited}`, logTail());
    const error = buildError(logTail(200));
    if (error) {
      if (!suspect || suspect.error !== error) suspect = { error, since: Date.now() };
      else if (Date.now() - suspect.since >= LOG_GRACE_MS) {
        stopWorker();
        fail(`the app did not start: wrangler dev logged an error before it answered on port ${WORKER_PORT}`, logTail());
      }
    }
    if (Date.now() >= until) {
      stopWorker();
      fail(`the app did not answer on port ${WORKER_PORT} within ${Math.round((Date.now() - from) / 1000)} seconds`, logTail());
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export function hostNetworked(config, envFile) {
  const services = config.services ?? {};
  const names = new Set();
  for (const [name, service] of Object.entries(services)) {
    names.add(name);
    for (const network of Object.values(service.networks ?? {})) for (const alias of network?.aliases ?? []) names.add(alias);
    if (service.hostname) names.add(service.hostname);
    if (service.container_name) names.add(service.container_name);
  }
  const hosts = [...names].map((name) => `${name}:127.0.0.1`);
  const out = { ...config, services: {} };
  delete out.networks;
  for (const [name, service] of Object.entries(services)) {
    const next = { ...service, network_mode: "host" };
    delete next.ports;
    delete next.networks;
    delete next.links;
    delete next.hostname;
    delete next.dns;
    delete next.dns_search;
    delete next.dns_opt;
    delete next.mac_address;
    next.extra_hosts = [...new Set([...(Array.isArray(service.extra_hosts) ? service.extra_hosts : Object.entries(service.extra_hosts ?? {}).map(([h, ip]) => `${h}:${ip}`)), ...hosts])];
    if (next.build) next.build = { ...next.build, network: "host" };
    if (envFile) next.env_file = [...(service.env_file ?? []), { path: envFile, required: true }];
    out.services[name] = next;
  }
  return out;
}

export function appPort(config) {
  const services = Object.entries(config.services ?? {});
  for (const [, service] of services) {
    const label = Number(service.labels?.["chef.port"]);
    if (Number.isInteger(label) && label > 0) return label;
  }
  for (const [, service] of services) {
    const first = (service.ports ?? [])[0];
    const target = Number(typeof first === "object" ? first?.target : String(first ?? "").split(":").pop()?.split("/")[0]);
    if (Number.isInteger(target) && target > 0) return target;
  }
  return null;
}

export function appService(config) {
  const services = Object.entries(config.services ?? {});
  const labelled = services.find(([, service]) => Number.isInteger(Number(service.labels?.["chef.port"])) && Number(service.labels?.["chef.port"]) > 0);
  if (labelled) return labelled[0];
  return services.find(([, service]) => (service.ports ?? []).length > 0)?.[0] ?? null;
}

export function stackTrouble(containers, service) {
  for (const container of containers) {
    if (container.state === "restarting" || container.restarts >= 2) return { service: container.service, reason: `${container.service} keeps crashing and restarting` };
    if (container.state !== "exited" && container.state !== "dead") continue;
    if (container.exitCode !== 0) return { service: container.service, reason: `${container.service} stopped with exit code ${container.exitCode}` };
    if (container.service === service) return { service: container.service, reason: `${container.service} stopped before it answered` };
  }
  return null;
}

export function buildError(logs) {
  const lines = String(logs ?? "").replace(ANSI, "").split("\n");
  return lines.find((line) => BUILD_ERRORS.some((pattern) => pattern.test(line)))?.trim() ?? null;
}

export function inspected(text) {
  let list;
  try {
    list = JSON.parse(text.slice(text.indexOf("[")));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.map((c) => ({ service: c.Config?.Labels?.["com.docker.compose.service"] ?? String(c.Name ?? "").replace(/^\//, ""), state: c.State?.Status ?? "unknown", exitCode: c.State?.ExitCode ?? 0, restarts: c.RestartCount ?? 0 }));
}

function compose(chefFile, ...args) {
  return run(["docker", "compose", "-p", job.project, "--project-directory", dir, "-f", chefFile, ...args], { env: dockerEnv, timeoutMs: 30_000, bounded: false });
}

function containers(chefFile) {
  const ids = compose(chefFile, "ps", "--all", "-q").stdout.split("\n").map((line) => line.trim()).filter((line) => /^[0-9a-f]{12,64}$/.test(line));
  if (ids.length === 0) return [];
  const found = run(["docker", "inspect", ...ids], { timeoutMs: 30_000, bounded: false });
  return found.code === 0 ? inspected(found.stdout) : [];
}

function logsOf(chefFile, service, lines) {
  return compose(chefFile, "logs", "--no-color", "--no-log-prefix", "--tail", String(lines), service).out;
}

async function answers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: globalThis.AbortSignal.timeout(3000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  stopWorker();
  syncWorkingCopy();
  const file = composeFile(dir);
  if (!file) {
    const worker = wranglerFile(dir);
    if (worker) return runWorker(worker);
    emit({ status: "no-stack", commitId: job.commitId });
    return;
  }
  const config = run(["docker", "compose", "-f", file, "config", "--format", "json"], { env: dockerEnv });
  if (config.code !== 0) fail(`reading ${file}`, config.out);
  const parsed = JSON.parse(config.out.slice(config.out.indexOf("{")));
  const port = appPort(parsed);
  if (!port) fail(`reading ${file}`, "no service publishes a port, so Chef does not know where the app answers; add a ports entry or a chef.port label");
  let envFile = null;
  if (job.env && Object.keys(job.env).length > 0) {
    envFile = join(home, "app.env");
    writeFileSync(envFile, Object.entries(job.env).map(([name, value]) => `${name}=${JSON.stringify(String(value))}`).join("\n") + "\n", { mode: 0o600 });
  }
  const chefFile = join(home, "compose.chef.json");
  const networked = hostNetworked(parsed, envFile);
  emit({ status: "starting", port, commitId: job.commitId });
  for (const [name, service] of Object.entries(networked.services)) {
    if (!service.build) continue;
    const image = service.image ?? `${job.project}-${name}`;
    const build = service.build;
    const args = ["docker", "build", "--network", "host", "-t", image];
    if (build.dockerfile) args.push("-f", join(build.context ?? dir, build.dockerfile));
    if (build.target) args.push("--target", build.target);
    for (const [key, value] of Object.entries(build.args ?? {})) if (value !== null && value !== undefined) args.push("--build-arg", `${key}=${value}`);
    args.push(build.context ?? dir);
    const built = run(args, { env: dockerEnv, timeoutMs: 1_500_000 });
    if (built.code !== 0) fail(built.timedOut ? `building ${name} did not finish within ${job.startSeconds ?? START_SECONDS} seconds` : `building ${name}`, built.out);
    delete service.build;
    service.image = image;
    service.pull_policy = "never";
  }
  writeFileSync(chefFile, JSON.stringify(networked, null, 2));
  const up = run(["docker", "compose", "-p", job.project, "--project-directory", dir, "-f", chefFile, "up", "-d", "--remove-orphans"], { env: dockerEnv, timeoutMs: 1_500_000 });
  if (up.code !== 0) fail(up.timedOut ? `starting the app did not finish within ${job.startSeconds ?? START_SECONDS} seconds` : "starting the app", up.out);
  await waitForApp(port, chefFile, appService(networked), Object.keys(networked.services));
}

async function waitForApp(port, chefFile, service, services) {
  const from = Date.now();
  const until = Math.min(deadline, from + (job.waitSeconds ?? PORT_SECONDS) * 1000);
  let suspect = null;
  for (;;) {
    if (await answers(port)) {
      emit({ status: "running", port, commitId: job.commitId });
      return;
    }
    const trouble = stackTrouble(containers(chefFile), service);
    if (trouble) fail(`the app did not start: ${trouble.reason}`, logsOf(chefFile, trouble.service, 40));
    for (const name of services) {
      const error = buildError(logsOf(chefFile, name, 200));
      if (!error) continue;
      if (!suspect || suspect.error !== error) suspect = { error, since: Date.now() };
      else if (Date.now() - suspect.since >= LOG_GRACE_MS) fail(`the app did not start: ${name} logged an error before it answered on port ${port}`, logsOf(chefFile, name, 40));
      break;
    }
    if (Date.now() >= until) fail(`the app did not answer on port ${port} within ${Math.round((Date.now() - from) / 1000)} seconds`, compose(chefFile, "logs", "--no-color", "--tail", "40").out);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (process.argv[1]?.endsWith("app.mjs") && process.env.CHEF_JOB) await main();
