import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const job = process.env.CHEF_JOB ? JSON.parse(Buffer.from(process.env.CHEF_JOB, "base64").toString("utf8")) : {};
const home = join(process.env.CHEF_WORKSPACE ?? "/workspace", job.target ?? "none");
const dir = join(home, "repo");
const emit = (event) => process.stdout.write(`${JSON.stringify({ type: "chef.app", ...event })}\n`);
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
const dockerEnv = { ...process.env, COMPOSE_BAKE: "false", DOCKER_BUILDKIT: "1" };

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

function tail(text, lines = 30) {
  return String(text ?? "").replace(ANSI, "").trim().split("\n").slice(-lines).join("\n");
}

function run(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: options.timeoutMs ?? 900_000, cwd: options.cwd ?? dir, env: options.env ?? process.env });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}` };
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

async function answers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: globalThis.AbortSignal.timeout(3000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  syncWorkingCopy();
  const file = composeFile(dir);
  if (!file) {
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
    if (built.code !== 0) fail(`building ${name}`, built.out);
    delete service.build;
    service.image = image;
    service.pull_policy = "never";
  }
  writeFileSync(chefFile, JSON.stringify(networked, null, 2));
  const up = run(["docker", "compose", "-p", job.project, "--project-directory", dir, "-f", chefFile, "up", "-d", "--remove-orphans"], { env: dockerEnv, timeoutMs: 1_500_000 });
  if (up.code !== 0) fail("starting the app", up.out);
  for (let waited = 0; waited < (job.waitSeconds ?? 300); waited += 2) {
    if (await answers(port)) {
      emit({ status: "running", port, commitId: job.commitId });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const logs = run(["docker", "compose", "-p", job.project, "-f", chefFile, "logs", "--no-color", "--tail", "40"], { env: dockerEnv });
  fail(`the app did not answer on port ${port}`, logs.out);
}

if (process.argv[1]?.endsWith("app.mjs") && process.env.CHEF_JOB) await main();
