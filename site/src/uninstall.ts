import { API } from "./oauth.ts";

export const PROJECT_TAG = "chef-project";
const REGISTRY = "registry.cloudflare.com";
const ENGINE_CLASS = "ProjectAgent";
const MAX_PAGES = 50;

export interface Removal {
  readonly accountId: string;
  readonly engine: string;
  readonly projects: readonly string[] | null;
  readonly ownAccount: boolean;
}

export interface Named {
  readonly id: string;
  readonly name: string;
}

export interface Image {
  readonly repo: string;
  readonly ref: string;
}

export interface Found {
  readonly engine: { readonly name: string; readonly id: string | null; readonly script: boolean } | null;
  readonly apps: readonly { readonly name: string; readonly id: string | null; readonly script: boolean }[];
  readonly workflows: readonly string[];
  readonly containers: readonly Named[];
  readonly indexes: readonly string[];
  readonly repos: readonly string[];
  readonly tokens: readonly Named[];
  readonly images: readonly Image[];
  readonly unchecked: readonly string[];
}

export interface Outcome {
  readonly failed: readonly string[];
  readonly left: readonly string[];
}

interface Envelope<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly result: T | null;
  readonly info: { readonly page?: number; readonly per_page?: number; readonly total_count?: number } | null;
  readonly error: string;
}

interface WorkerRow {
  readonly id?: string;
  readonly name?: string;
  readonly tags?: readonly string[] | null;
}

interface NamespaceRow {
  readonly id?: string;
  readonly script?: string | null;
  readonly class?: string;
}

interface ContainerRow {
  readonly id?: string;
  readonly name?: string;
  readonly durable_objects?: { readonly namespace_id?: string } | null;
  readonly configuration?: { readonly image?: string } | null;
}

export class StopRemoval extends Error {}

export function previewsTokenName(engine: string): string {
  return `chef previews (${engine})`;
}

export function containerAppName(engine: string): string {
  return `${engine}-sessionagent`;
}

export function readImage(ref: string | undefined, accountId: string): Image | null {
  const prefix = `${REGISTRY}/${accountId}/`;
  if (!ref?.startsWith(prefix)) return null;
  const rest = ref.slice(prefix.length);
  const at = rest.indexOf("@");
  const named = at >= 0 ? rest.slice(0, at) : rest;
  const colon = named.lastIndexOf(":");
  const repo = colon >= 0 ? named.slice(0, colon) : named;
  const ref2 = colon >= 0 ? named.slice(colon + 1) : at >= 0 ? rest.slice(at + 1) : "";
  return repo && ref2 ? { repo, ref: ref2 } : null;
}

export function ownsApp(name: string, engine: string, engines: ReadonlySet<string>, projects: readonly string[] | null): boolean {
  if (!name.startsWith(`${engine}-`)) return false;
  for (const other of engines) {
    if (other === engine) continue;
    if (other.startsWith(`${engine}-`) && (name === other || name.startsWith(`${other}-`))) return false;
  }
  const shared = [...engines].some((other) => other !== engine && engine.startsWith(`${other}-`));
  return !shared || projects === null || projects.includes(name.slice(engine.length + 1));
}

export class Uninstaller {
  constructor(
    private readonly token: string,
    private readonly job: Removal,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async find(): Promise<Found> {
    const { engine } = this.job;
    const unchecked: string[] = [];
    const must = <T>(what: string, rows: T[] | null): T[] => {
      if (rows === null) throw new StopRemoval(`Cloudflare did not let chef list the ${what} on this account; sign in again and share this account on Cloudflare's page`);
      return rows;
    };
    const [scripts, workers, namespaces, workflows, containers, indexes] = await Promise.all([
      this.list<WorkerRow>("/workers/scripts"),
      this.list<WorkerRow>("/workers/workers?per_page=100"),
      this.list<NamespaceRow>("/workers/durable_objects/namespaces?per_page=1000"),
      this.list<{ name?: string; script_name?: string }>("/workflows?per_page=100"),
      this.list<ContainerRow>("/containers/applications"),
      this.list<{ name?: string }>("/vectorize/v2/indexes"),
    ]);
    const scriptRows = must("Workers", scripts);
    const nsRows = must("Durable Objects", namespaces);
    const workerRows = workers ?? [];
    const engines = new Set(nsRows.filter((n) => n.class === ENGINE_CLASS && n.script).map((n) => n.script as string));
    const scriptNames = new Set(scriptRows.flatMap((s) => (s.id ? [s.id] : [])));
    const workerIds = new Map(workerRows.flatMap((w) => (w.name && w.id ? [[w.name, w.id] as const] : [])));
    const tags = new Map<string, readonly string[]>();
    for (const row of [...scriptRows, ...workerRows]) {
      const name = row.name ?? row.id;
      if (name && row.tags) tags.set(name, [...(tags.get(name) ?? []), ...row.tags]);
    }
    const hasEngine = scriptNames.has(engine) || workerIds.has(engine);
    if (hasEngine && !engines.has(engine)) throw new StopRemoval(`a Worker named ${engine} is on this account but it is not a chef engine, so chef left everything as it was`);
    const appNames = [...new Set([...scriptNames, ...workerIds.keys()])].filter((name) => name !== engine && (tags.get(name) ?? []).includes(PROJECT_TAG) && ownsApp(name, engine, engines, this.job.projects)).sort();
    const ours = new Set([engine, ...appNames]);
    const ourNamespaces = new Set(nsRows.filter((n) => n.script && ours.has(n.script) && n.id).map((n) => n.id as string));
    const containerRows = must("containers", containers);
    const isOurs = (c: ContainerRow) => c.name === containerAppName(engine) || (c.durable_objects?.namespace_id !== undefined && ourNamespaces.has(c.durable_objects.namespace_id));
    const ourContainers = containerRows.filter((c) => c.id && c.name && isOurs(c));
    const repos = await this.list<{ name?: string }>(`/artifacts/namespaces/${encodeURIComponent(engine)}/repos?per_page=100`, true);
    const tokens = await this.list<{ id?: string; name?: string }>("/tokens?per_page=50");
    if (tokens === null) unchecked.push(`the previews token "${previewsTokenName(engine)}"`);
    return {
      engine: hasEngine ? { name: engine, id: workerIds.get(engine) ?? null, script: scriptNames.has(engine) } : null,
      apps: appNames.map((name) => ({ name, id: workerIds.get(name) ?? null, script: scriptNames.has(name) })),
      workflows: must("Workflows", workflows).filter((w) => w.name && w.script_name && ours.has(w.script_name)).map((w) => w.name as string),
      containers: ourContainers.map((c) => ({ id: c.id as string, name: c.name as string })),
      indexes: must("Vectorize indexes", indexes).filter((i) => i.name === `${engine}-memory`).map((i) => i.name as string),
      repos: must("repos", repos).flatMap((r) => (r.name ? [r.name] : [])),
      tokens: (tokens ?? []).filter((t) => t.id && t.name === previewsTokenName(engine)).map((t) => ({ id: t.id as string, name: t.name as string })),
      images: await this.images(ourContainers, containerRows.filter((c) => !isOurs(c)), unchecked),
      unchecked,
    };
  }

  async remove(found: Found, log: (line: string) => void, step: (id: "engine" | "apps" | "data") => Promise<void> = async () => undefined, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<Outcome> {
    const failed: string[] = [];
    const left: string[] = [...found.unchecked];
    const del = async (what: string, path: string, required = true) => {
      const res = await this.call("DELETE", path);
      if (res.ok || res.status === 404) return log(`removed ${what}`);
      (required ? failed : left).push(`${what} (${res.error})`);
      log(`could not remove ${what}: ${res.error}`);
    };
    const engine = this.job.engine;
    await step("engine");
    if (found.engine) await this.call("DELETE", `/triggers/${encodeURIComponent(engine)}`);
    for (const name of found.workflows) await del(`the workflow ${name}`, `/workflows/${encodeURIComponent(name)}`);
    if (found.engine) await this.removeWorker(found.engine, `chef's engine ${engine}`, log, failed);
    for (const app of found.containers) await del(`the sandboxes ${app.name}`, `/containers/applications/${encodeURIComponent(app.id)}`);
    await step("apps");
    for (const app of found.apps) await this.removeWorker(app, `the app ${app.name} and its previews`, log, failed);
    await step("data");
    for (const repo of found.repos) await del(`the repo ${engine}/${repo}`, `/artifacts/namespaces/${encodeURIComponent(engine)}/repos/${encodeURIComponent(repo)}`);
    for (const index of found.indexes) await del(`the memory index ${index}`, `/vectorize/v2/indexes/${encodeURIComponent(index)}`);
    for (const token of found.tokens) await del(`the previews token "${token.name}"`, `/tokens/${encodeURIComponent(token.id)}`, false);
    if (found.images.length > 0) await this.removeImages(found.images, log, left);
    if (found.repos.length > 0 || found.engine) await this.call("DELETE", `/artifacts/namespaces/${encodeURIComponent(engine)}`);
    if (failed.length === 0) failed.push(...(await this.check(wait)));
    return { failed, left };
  }

  private async check(wait: (ms: number) => Promise<void>): Promise<string[]> {
    let left: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await wait(5000);
      try {
        left = leftovers(await this.find());
      } catch (error) {
        left = [`checking what is left (${error instanceof Error ? error.message : String(error)})`];
      }
      if (left.length === 0) return left;
    }
    return left;
  }

  private async removeWorker(worker: { readonly name: string; readonly id: string | null; readonly script: boolean }, what: string, log: (line: string) => void, failed: string[]): Promise<void> {
    const paths = [...(worker.script ? [`/workers/scripts/${encodeURIComponent(worker.name)}?force=true`] : []), ...(worker.id ? [`/workers/workers/${encodeURIComponent(worker.id)}`] : [])];
    for (const path of paths) {
      const res = await this.call("DELETE", path);
      if (res.ok || res.status === 404) continue;
      failed.push(`${what} (${res.error})`);
      return log(`could not remove ${what}: ${res.error}`);
    }
    log(`removed ${what}`);
  }

  private async images(ours: readonly ContainerRow[], others: readonly ContainerRow[], unchecked: string[]): Promise<Image[]> {
    const { accountId, engine, ownAccount } = this.job;
    const read = (rows: readonly ContainerRow[]) => rows.flatMap((c) => {
      const image = readImage(c.configuration?.image, accountId);
      return image ? [image] : [];
    });
    const mine = read(ours);
    const shared = new Set(read(others).map((t) => t.repo));
    const out: Image[] = [];
    for (const repo of new Set(mine.map((m) => m.repo))) {
      if (shared.has(repo) || (ownAccount && !repo.startsWith(`${engine}-`))) continue;
      const tags = await this.registryTags(repo);
      if (tags === null) unchecked.push(`the sandbox image ${repo}`);
      const refs = new Set([...mine.filter((m) => m.repo === repo).map((m) => m.ref), ...(tags ?? [])]);
      for (const ref of refs) out.push({ repo, ref });
    }
    return out;
  }

  private async removeImages(images: readonly Image[], log: (line: string) => void, left: string[]): Promise<void> {
    const auth = await this.registryAuth();
    if (!auth) {
      left.push("the sandbox image (Cloudflare did not hand out registry access)");
      return;
    }
    for (const image of images) {
      const url = `https://${REGISTRY}/v2/${this.job.accountId}/${image.repo}/manifests/${image.ref}`;
      const res = await this.fetcher(url, { method: "DELETE", headers: { authorization: auth, accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json" } }).catch(() => null);
      if (res && (res.ok || res.status === 404)) log(`removed the sandbox image ${image.repo}:${image.ref}`);
      else left.push(`the sandbox image ${image.repo}:${image.ref} (${res ? `status ${res.status}` : "no answer"})`);
    }
    await this.fetcher(`https://${REGISTRY}/v2/gc/layers`, { method: "PUT", headers: { authorization: auth, "content-type": "application/json" } }).catch(() => null);
  }

  private async registryTags(repo: string): Promise<string[] | null> {
    const auth = await this.registryAuth();
    if (!auth) return null;
    const res = await this.fetcher(`https://${REGISTRY}/v2/${this.job.accountId}/${repo}/tags/list`, { headers: { authorization: auth } }).catch(() => null);
    if (res?.status === 404) return [];
    if (!res?.ok) return null;
    const body = (await res.json().catch(() => null)) as { tags?: unknown } | null;
    return Array.isArray(body?.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
  }

  private registry: Promise<string | null> | null = null;

  private registryAuth(): Promise<string | null> {
    this.registry ??= this.call<{ username?: string; password?: string }>("POST", `/containers/registries/${REGISTRY}/credentials`, { expiration_minutes: 10, permissions: ["pull", "push"] }).then((res) =>
      res.ok && res.result?.password ? `Basic ${btoa(`${res.result.username ?? "v1"}:${res.result.password}`)}` : null,
    );
    return this.registry;
  }

  private async list<T>(path: string, missingIsEmpty = false): Promise<T[] | null> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.call<T[]>("GET", `${path}${path.includes("?") ? "&" : "?"}page=${page}`);
      if (missingIsEmpty && res.status === 404) return out;
      if (!res.ok) return page === 1 ? null : out;
      const rows = Array.isArray(res.result) ? res.result : [];
      out.push(...rows);
      const info = res.info;
      if (rows.length === 0 || info?.page === undefined || info.per_page === undefined || info.total_count === undefined || info.page * info.per_page >= info.total_count) break;
    }
    return out;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
    const response = await this.fetcher(`${API}/accounts/${this.job.accountId}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch(() => null);
    if (!response) return { ok: false, status: 0, result: null, info: null, error: "Cloudflare did not answer" };
    const parsed = (await response.json().catch(() => ({}))) as { success?: boolean; result?: T; result_info?: Envelope<T>["info"]; errors?: readonly { message?: string }[] };
    const error = (parsed.errors ?? []).map((e) => e.message).filter(Boolean).join("; ") || `status ${response.status}`;
    return { ok: response.ok && parsed.success !== false, status: response.status, result: parsed.result ?? null, info: parsed.result_info ?? null, error };
  }
}

export function leftovers(found: Found): string[] {
  return [
    ...(found.engine ? [`chef's engine ${found.engine.name}`] : []),
    ...found.apps.map((a) => `the app ${a.name}`),
    ...found.workflows.map((w) => `the workflow ${w}`),
    ...found.containers.map((c) => `the sandboxes ${c.name}`),
    ...found.indexes.map((i) => `the memory index ${i}`),
    ...found.repos.map((r) => `the repo ${r}`),
  ].map((what) => `${what} is still there`);
}

export function summary(found: Found): string[] {
  const lines: string[] = [];
  if (found.engine) lines.push(`chef's engine ${found.engine.name}`);
  for (const app of found.apps) lines.push(`the app ${app.name} with its previews`);
  for (const name of found.workflows) lines.push(`the workflow ${name}`);
  for (const app of found.containers) lines.push(`the sandboxes ${app.name}`);
  for (const repo of found.repos) lines.push(`the repo ${repo}`);
  for (const index of found.indexes) lines.push(`the memory index ${index}`);
  for (const token of found.tokens) lines.push(`the previews token "${token.name}"`);
  for (const image of found.images) lines.push(`the sandbox image ${image.repo}:${image.ref}`);
  return lines;
}
