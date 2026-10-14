import { API } from "../src/oauth.ts";
import { leftovers, PROJECT_TAG, previewsTokenName, summary, Uninstaller } from "../src/uninstall.ts";

const token = process.env["CLOUDFLARE_API_TOKEN"] ?? "";
const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "";
const engine = process.env["ENGINE"] ?? "";
const decoy = `${engine}-decoy`;
const fakeApp = `${engine}-demo`;
const say = (line: string) => process.stdout.write(`${line}\n`);

if (!token || !accountId || !/^chef-uninstall-check-[a-z0-9]{4}$/.test(engine)) {
  console.error("set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and ENGINE=chef-uninstall-check-xxxx");
  process.exit(2);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; result: T | null; info: { page?: number; per_page?: number; total_count?: number } | null; error: string }> {
  const response = await fetch(`${API}/accounts/${accountId}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const parsed = (await response.json().catch(() => ({}))) as { success?: boolean; result?: T; result_info?: { page?: number; per_page?: number; total_count?: number }; errors?: { message?: string }[] };
  return { ok: response.ok && parsed.success !== false, result: parsed.result ?? null, info: parsed.result_info ?? null, error: (parsed.errors ?? []).map((e) => e.message).join("; ") || String(response.status) };
}

async function list<T>(path: string): Promise<T[] | null> {
  const out: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await call<T[]>("GET", `${path}${path.includes("?") ? "&" : "?"}page=${page}`);
    if (!res.ok) return page === 1 ? null : out;
    const rows = res.result ?? [];
    out.push(...rows);
    const info = res.info;
    if (rows.length === 0 || !info?.page || !info.per_page || !info.total_count || info.page * info.per_page >= info.total_count) break;
  }
  return out;
}

async function snapshot(): Promise<Set<string>> {
  const out = new Set<string>();
  const add = (kind: string, rows: unknown[] | null, name: (row: never) => string | undefined) => {
    if (rows === null) return say(`  (could not list ${kind})`);
    for (const row of rows) {
      const value = name(row as never);
      if (value) out.add(`${kind} ${value}`);
    }
  };
  add("script", await list("/workers/scripts"), (r: { id?: string }) => r.id);
  add("worker", await list("/workers/workers?per_page=100"), (r: { name?: string }) => r.name);
  add("workflow", await list("/workflows?per_page=100"), (r: { name?: string; script_name?: string }) => `${r.name} (${r.script_name})`);
  add("namespace", await list("/workers/durable_objects/namespaces?per_page=1000"), (r: { script?: string; class?: string }) => `${r.script}/${r.class}`);
  add("container", await list("/containers/applications"), (r: { name?: string }) => r.name);
  add("index", await list("/vectorize/v2/indexes"), (r: { name?: string }) => r.name);
  add("token", await list("/tokens?per_page=50"), (r: { name?: string }) => r.name);
  const namespaces = new Set([engine, ...((await list<{ name?: string }>("/artifacts/namespaces")) ?? []).flatMap((ns) => (ns.name ? [ns.name] : []))]);
  for (const name of namespaces) add("repo", await list(`/artifacts/namespaces/${encodeURIComponent(name)}/repos?per_page=100`), (r: { name?: string }) => `${name}/${r.name}`);
  return out;
}

function owned(entry: string): boolean {
  const [kind, ...rest] = entry.split(" ");
  const value = rest.join(" ");
  if (value.startsWith(decoy)) return false;
  const ours = (name: string) => name === engine || name.startsWith(`${engine}-`);
  if (kind === "workflow") return ours(value.split(" ")[0] ?? "");
  if (kind === "namespace") return ours(value.split("/")[0] ?? "");
  if (kind === "repo") return value.split("/")[0] === engine;
  if (kind === "token") return value === previewsTokenName(engine);
  return ours(value);
}

async function prepare(): Promise<void> {
  for (const [name, tags] of [[fakeApp, [PROJECT_TAG]], [decoy, []]] as const) {
    const made = await call("POST", "/workers/workers", { name, tags, subdomain: { enabled: false } });
    say(made.ok ? `made the Worker ${name}${tags.length ? " tagged as a chef app" : " with no chef tag"}` : `could not make ${name}: ${made.error}`);
    if (!made.ok) process.exit(1);
  }
}

async function run(): Promise<void> {
  const before = await snapshot();
  say(`before: ${before.size} resources on the account, ${[...before].filter(owned).length} of them made by ${engine}`);
  for (const entry of [...before].filter(owned).sort()) say(`  ${entry}`);
  const tool = new Uninstaller(token, { accountId, engine, projects: null, ownAccount: true });
  const found = await tool.find();
  say("the site would remove:");
  for (const line of summary(found, engine)) say(`  ${line}`);
  const outcome = await tool.remove(found, (line) => say(`  ${line}`));
  const after = await snapshot();
  const removed = [...before].filter((e) => !after.has(e));
  const added = [...after].filter((e) => !before.has(e));
  const expected = [...before].filter(owned);
  const wrong = removed.filter((e) => !owned(e));
  const missed = expected.filter((e) => after.has(e));
  say(`removed ${removed.length}; expected ${expected.length}; failed: ${outcome.failed.join("; ") || "none"}; left for the person: ${outcome.left.join("; ") || "none"}`);
  for (const entry of added) say(`  appeared meanwhile (not ours to judge): ${entry}`);
  for (const entry of wrong) console.error(`REMOVED SOMETHING NOT MADE BY ${engine}: ${entry}`);
  for (const entry of missed) console.error(`still there: ${entry}`);
  if (!after.has(`worker ${decoy}`)) console.error(`the decoy ${decoy} was removed`);
  if (wrong.length > 0 || missed.length > 0 || outcome.failed.length > 0 || !after.has(`worker ${decoy}`)) process.exit(1);
  say(`ok: everything ${engine} made is gone and nothing else on the account changed`);
}

async function cleanup(): Promise<void> {
  const tool = new Uninstaller(token, { accountId, engine, projects: null, ownAccount: true });
  const found = await tool.find().catch(() => null);
  if (found && leftovers(found).length > 0) await tool.remove(found, (line) => say(`  ${line}`));
  const workers = (await list<{ id?: string; name?: string }>("/workers/workers?per_page=100")) ?? [];
  for (const worker of workers) if (worker.name === decoy && worker.id) say(`removed the decoy ${decoy}: ${(await call("DELETE", `/workers/workers/${worker.id}`)).ok}`);
}

const step = process.argv[2];
if (step === "prepare") await prepare();
else if (step === "run") await run();
else if (step === "cleanup") await cleanup();
else {
  console.error("usage: uninstall-check.ts prepare|run|cleanup");
  process.exit(2);
}
