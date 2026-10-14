import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = "https://api.cloudflare.com/client/v4";
const REGISTRY = "registry.cloudflare.com";
const REPO = process.env.CHEF_REPO ?? "/opt/chef";
const job = JSON.parse(Buffer.from(process.env.CHEF_JOB ?? "", "base64").toString("utf8"));
const id = job.accountId;

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const log = (line) => emit({ type: "log", line });
const step = (name, state) => emit({ type: "step", id: name, state });
const fail = (name, message) => {
  step(name, "failed");
  emit({ type: "error", message });
  process.exit(1);
};

async function cf(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${job.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).catch((error) => ({ ok: false, status: 0, json: async () => ({ errors: [{ message: String(error) }] }) }));
  const parsed = await response.json().catch(() => ({}));
  return { ok: response.ok && parsed.success !== false, status: response.status, result: parsed.result ?? parsed, errors: parsed.errors ?? [] };
}

const reason = (res) => res.errors.map((e) => e.message).filter(Boolean).join("; ") || `status ${res.status}`;

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO, env: { ...process.env, ...options.env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const take = (chunk) => {
      const text = chunk.toString();
      out += text;
      if (!options.quiet) for (const line of text.split(/\r?\n/)) if (line.trim() && !/^\[custom build\]\s*$/.test(line.trim())) log(line);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.stdin.end(options.input ?? "");
    child.on("error", (error) => resolve({ code: 1, out: String(error) }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

const planHint = (text) => (/paid|plan|subscri|entitle|not enabled|unauthorized to access/i.test(text) ? " chef needs the Workers Paid plan on this account, which includes Containers and Artifacts." : "");

function slug(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

step("account", "running");
const scripts = await cf("GET", `/accounts/${id}/workers/scripts`);
if (!scripts.ok) fail("account", `Cloudflare refused to list Workers on this account: ${reason(scripts)}`);
const existing = Array.isArray(scripts.result) && scripts.result.some((script) => script.id === job.name);
const subdomain = await cf("GET", `/accounts/${id}/workers/subdomain`);
let host = subdomain.ok ? subdomain.result?.subdomain : null;
if (!host) {
  const account = await cf("GET", `/accounts/${id}`);
  const base = slug(account.result?.name) || "chef";
  for (let i = 0; i < 4 && !host; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const made = await cf("PUT", `/accounts/${id}/workers/subdomain`, { subdomain: candidate });
    if (made.ok) host = made.result?.subdomain ?? candidate;
    else log(`could not use ${candidate}.workers.dev: ${reason(made)}`);
  }
  if (!host) fail("account", "this account has no workers.dev address yet, and chef could not create one");
  log(`created ${host}.workers.dev for this account`);
}
log(existing ? `updating the chef already on this account` : `setting up chef on ${host}.workers.dev`);
step("account", "done");

step("image", "running");
const creds = await cf("POST", `/accounts/${id}/containers/registries/${REGISTRY}/credentials`, { expiration_minutes: 30, permissions: ["push", "pull"] });
if (!creds.ok || !creds.result?.username) fail("image", `Cloudflare did not let chef add its sandbox image: ${reason(creds)}.${planHint(reason(creds)) || " chef needs the Workers Paid plan on this account."}`);
const work = mkdtempSync(join(tmpdir(), "chef-install-"));
const source = join(work, "source");
const target = join(work, "target");
mkdirSync(source);
mkdirSync(target);
const tarball = join(work, "sandbox.tar");
const name = job.source.image.split("/").pop().split("@")[0];
const destination = `${REGISTRY}/${id}/${name}`;
if ((await run("crane", ["auth", "login", REGISTRY, "-u", job.source.username, "--password-stdin"], { env: { DOCKER_CONFIG: source }, input: job.source.password, quiet: true })).code !== 0) fail("image", "could not read chef's sandbox image; try again in a minute");
log(`copying the sandbox image ${name}`);
if ((await run("crane", ["pull", job.source.image, tarball], { env: { DOCKER_CONFIG: source }, quiet: true })).code !== 0) fail("image", "could not download chef's sandbox image; try again in a minute");
if ((await run("crane", ["auth", "login", REGISTRY, "-u", creds.result.username, "--password-stdin"], { env: { DOCKER_CONFIG: target }, input: creds.result.password, quiet: true })).code !== 0) fail("image", "could not sign in to your account's container registry");
const pushed = await run("crane", ["push", tarball, destination], { env: { DOCKER_CONFIG: target }, quiet: true });
rmSync(work, { recursive: true, force: true });
const image = pushed.out.trim().split(/\s+/).pop() ?? "";
if (pushed.code !== 0 || !/@sha256:[0-9a-f]{64}$/.test(image)) fail("image", `could not add the sandbox image to your account.${planHint(pushed.out)}`);
log(`sandbox image ready: ${image}`);
step("image", "done");

step("token", "running");
let previewToken = null;
const secrets = existing ? await cf("GET", `/accounts/${id}/workers/scripts/${job.name}/secrets`) : null;
const hasToken = secrets?.ok && Array.isArray(secrets.result) && secrets.result.some((secret) => secret.name === "CF_API_TOKEN");
if (hasToken) {
  log("keeping the previews token chef already has");
  step("token", "done");
} else {
  const groups = await cf("GET", `/accounts/${id}/tokens/permission_groups`);
  const group = groups.ok && Array.isArray(groups.result) ? groups.result.find((g) => g.name === "Workers Scripts Write") : null;
  if (group) {
    const made = await cf("POST", `/accounts/${id}/tokens`, { name: `chef previews (${job.name})`, policies: [{ effect: "allow", resources: { [`com.cloudflare.api.account.${id}`]: "*" }, permission_groups: [{ id: group.id }] }] });
    if (made.ok && made.result?.value) previewToken = made.result.value;
    else log(`could not create a token for previews: ${reason(made)}`);
  } else log(`could not look up token permissions: ${reason(groups)}`);
  if (previewToken) log("created a token that lets chef publish previews in this account");
  else log("previews need Account API Tokens Write: sign in again and turn it on under Sensitive scopes on Cloudflare's page");
  step("token", previewToken ? "done" : "skipped");
}

step("deploy", "running");
const secretsDir = mkdtempSync(join(tmpdir(), "chef-secrets-"));
const secretsFile = join(secretsDir, "secrets.json");
writeFileSync(secretsFile, JSON.stringify({ CF_ACCOUNT_ID: id, ...(previewToken ? { CF_API_TOKEN: previewToken } : {}), ...(job.password ? { CHEF_PASSWORD: job.password } : {}) }), { mode: 0o600 });
const deployed = await run("node", ["--import", "tsx", "cli/src/bin.ts", "deploy", "--name", job.name, "--image", image, "--secrets-file", secretsFile], {
  env: { CLOUDFLARE_API_TOKEN: job.token, CLOUDFLARE_ACCOUNT_ID: id, CI: "true", WRANGLER_SEND_METRICS: "false" },
});
rmSync(secretsDir, { recursive: true, force: true });
if (deployed.code !== 0) fail("deploy", `Cloudflare did not accept the deploy.${planHint(deployed.out)} The log has the details.`);
const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(deployed.out)?.[0] ?? `https://${job.name}.${host}.workers.dev`;
step("deploy", "done");
emit({ type: "done", url });
