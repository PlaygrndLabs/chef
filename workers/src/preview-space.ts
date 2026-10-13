import type { PreviewSpace } from "@chef/core";
import type { PlainEnvVar } from "@chef/adapters/project-env";
import { previewName } from "./sandbox-checks.ts";

export type EnvPatch = Readonly<Record<string, { readonly type: "secret_text" | "plain_text"; readonly text: string } | null>>;

export const PROJECT_WORKER_TAG = "chef-project";
const BULK_SECRETS = 100;

interface WorkerInfo {
  readonly tags?: readonly string[];
  readonly previews_base_config?: { readonly env?: Record<string, unknown> };
}

export class WorkerTakenError extends Error {}

export class CloudflareWorkerSpace implements PreviewSpace {
  constructor(
    private readonly grant: { readonly accountId: string; readonly worker: string },
    private readonly apiToken: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async ensure(): Promise<void> {
    const worker = await this.api<WorkerInfo>("GET", this.workerPath(), undefined, true);
    if (worker) {
      if (!(worker.tags ?? []).includes(PROJECT_WORKER_TAG)) throw new WorkerTakenError(`a Worker named ${this.grant.worker} already exists in this Cloudflare account and chef did not make it; pick another project name`);
      return;
    }
    try {
      await this.api("POST", "/workers/workers", { name: this.grant.worker, tags: [PROJECT_WORKER_TAG], subdomain: { enabled: true, previews_enabled: true } });
    } catch (error) {
      if (!/10040|already exists/.test(String(error))) throw error;
      await this.ensure();
    }
  }

  async remove(branches: readonly string[]): Promise<void> {
    for (const branch of branches) {
      const path = `${this.workerPath()}/previews/${encodeURIComponent(previewName(branch, this.grant.worker))}`;
      await this.api("DELETE", path, undefined, true);
    }
  }

  async removeWorker(name: string): Promise<void> {
    await this.api("DELETE", `/workers/scripts/${encodeURIComponent(name)}?force=true`, undefined, true);
  }

  async liveUrl(): Promise<string> {
    const account = await this.api<{ subdomain?: string }>("GET", "/workers/subdomain");
    if (!account?.subdomain) throw new Error("this Cloudflare account has no workers.dev subdomain yet");
    return `https://${this.grant.worker}.${account.subdomain}.workers.dev`;
  }

  async applyEnvironment(vars: readonly PlainEnvVar[], options: { readonly create: boolean }): Promise<EnvPatch | null> {
    let worker = await this.api<WorkerInfo>("GET", this.workerPath(), undefined, true);
    if (!worker) {
      if (!options.create) return null;
      await this.ensure();
      worker = {};
    }
    const patch: Record<string, EnvPatch[string]> = {};
    for (const name of Object.keys(worker.previews_base_config?.env ?? {})) patch[name] = null;
    for (const v of vars) patch[v.name] = { type: v.secret ? "secret_text" : "plain_text", text: v.value };
    if (Object.keys(patch).length === 0) return patch;
    await this.api("PATCH", this.workerPath(), { previews_base_config: { env: patch } }, false, "application/merge-patch+json");
    return patch;
  }

  async applyLiveEnvironment(vars: readonly PlainEnvVar[]): Promise<void> {
    const current = (await this.api<readonly { readonly name: string }[]>("GET", `${this.scriptPath()}/secrets`)) ?? [];
    const secrets: Record<string, { readonly name: string; readonly text: string; readonly type: "secret_text" } | null> = {};
    for (const { name } of current) if (!vars.some((v) => v.name === name)) secrets[name] = null;
    for (const v of vars) secrets[v.name] = { name: v.name, text: v.value, type: "secret_text" };
    const entries = Object.entries(secrets);
    for (let i = 0; i < entries.length; i += BULK_SECRETS) {
      await this.api("PATCH", `${this.scriptPath()}/secrets-bulk`, { secrets: Object.fromEntries(entries.slice(i, i + BULK_SECRETS)) }, false, "application/merge-patch+json");
    }
  }

  async refreshPreview(name: string, patch: EnvPatch): Promise<void> {
    await this.api("PATCH", `${this.workerPath()}/previews/${encodeURIComponent(name)}/deployments/latest`, { env: patch, annotations: { "workers/message": "chef: environment changed" } }, false, "application/merge-patch+json");
  }

  private workerPath(): string {
    return `/workers/workers/${encodeURIComponent(this.grant.worker)}`;
  }

  private scriptPath(): string {
    return `/workers/scripts/${encodeURIComponent(this.grant.worker)}`;
  }

  private async api<T>(method: string, path: string, body?: unknown, missingOk = false, contentType = "application/json"): Promise<T | null> {
    const response = await this.fetcher(`https://api.cloudflare.com/client/v4/accounts/${this.grant.accountId}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiToken}`, ...(body === undefined ? {} : { "content-type": contentType }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (missingOk && response.status === 404) return null;
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(`${method} ${path.replace(/\/previews\/.*/, "/previews/…")} on Cloudflare failed with ${response.status}: ${redact(text).slice(0, 500)}`);
    return ((JSON.parse(text || "{}") as { result?: T }).result ?? null) as T | null;
  }
}

function redact(text: string): string {
  return text.replace(/"text"\s*:\s*"[^"]*"/g, '"text":"…"');
}
