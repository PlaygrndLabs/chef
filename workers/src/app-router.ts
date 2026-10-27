import { APP_KEY_VAR, APP_TARGET_VAR, ROUTER_MODULE, routerModule } from "@chef/adapters/app-gate";

export const ROUTER_TAG = "chef-router";
const COMPATIBILITY_DATE = "2026-10-01";

export class RouterTakenError extends Error {}

interface WorkerInfo {
  readonly tags?: readonly string[];
}

interface PreviewInfo {
  readonly id?: string;
  readonly name?: string;
  readonly urls?: readonly string[];
}

export function routerName(engine: string): string {
  return `${engine}-app`;
}

export function appName(label: string, router: string): string {
  const max = Math.max(1, Math.min(40, 62 - router.length));
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/, "") || "app"
  );
}

const CONCURRENT_RETRIES = 5;

export class AppRouter {
  constructor(
    private readonly account: { readonly accountId: string; readonly apiToken: string },
    readonly router: string,
    private readonly engine: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async address(input: { readonly label: string; readonly target: string; readonly key: string }): Promise<string> {
    await this.ensure();
    const name = appName(input.label, this.router);
    const path = `${this.workerPath()}/previews/${encodeURIComponent(name)}`;
    const preview = (await this.api<PreviewInfo>("GET", path, undefined, true)) ?? (await this.createPreview(name, path));
    const form = new FormData();
    form.set(
      "metadata",
      JSON.stringify({
        main_module: ROUTER_MODULE,
        compatibility_date: COMPATIBILITY_DATE,
        env: {
          SESSION: { type: "durable_object_namespace", class_name: "SessionAgent", script_name: this.engine },
          [APP_TARGET_VAR]: { type: "plain_text", text: input.target },
          [APP_KEY_VAR]: { type: "secret_text", text: input.key },
        },
        annotations: { "workers/message": `Chef: address of ${input.target}` },
      }),
    );
    form.append("files", new File([routerModule()], ROUTER_MODULE, { type: "application/javascript+module" }));
    await this.api("POST", `${path}/deployments`, form);
    const url = preview?.urls?.[0];
    if (url) return url;
    const account = await this.api<{ subdomain?: string }>("GET", "/workers/subdomain");
    if (!account?.subdomain) throw new Error("this Cloudflare account has no workers.dev subdomain yet");
    return `https://${name}-${this.router}.${account.subdomain}.workers.dev`;
  }

  async remove(labels: readonly string[]): Promise<void> {
    for (const label of labels) await this.api("DELETE", `${this.workerPath()}/previews/${encodeURIComponent(appName(label, this.router))}`, undefined, true);
  }

  private async createPreview(name: string, path: string): Promise<PreviewInfo | null> {
    try {
      return await this.api<PreviewInfo>("POST", `${this.workerPath()}/previews`, { name });
    } catch (error) {
      if (!/100338|already exists/.test(String(error))) throw error;
      return this.api<PreviewInfo>("GET", path, undefined, true);
    }
  }

  private async ensure(): Promise<void> {
    const worker = await this.api<WorkerInfo>("GET", this.workerPath(), undefined, true);
    if (worker) {
      if (!(worker.tags ?? []).includes(ROUTER_TAG)) throw new RouterTakenError(`a Worker named ${this.router} already exists in this Cloudflare account and Chef did not make it, so Chef cannot give apps their addresses`);
      return;
    }
    try {
      await this.api("POST", "/workers/workers", { name: this.router, tags: [ROUTER_TAG], subdomain: { enabled: true, previews_enabled: true } });
    } catch (error) {
      if (!/10040|already exists/.test(String(error))) throw error;
      await this.ensure();
    }
  }

  private workerPath(): string {
    return `/workers/workers/${encodeURIComponent(this.router)}`;
  }

  private async api<T>(method: string, path: string, body?: unknown, missingOk = false): Promise<T | null> {
    const form = body instanceof FormData;
    let response: Response;
    let text: string;
    for (let attempt = 0; ; attempt++) {
      response = await this.fetcher(`https://api.cloudflare.com/client/v4/accounts/${this.account.accountId}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.account.apiToken}`, ...(body === undefined || form ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
      });
      text = await response.text().catch(() => "");
      if (response.status !== 409 || !/"code"\s*:\s*11024\b/.test(text) || attempt >= CONCURRENT_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt + Math.random() * 250));
    }
    if (missingOk && (response.status === 404 || /"code"\s*:\s*10025\b/.test(text))) return null;
    if (!response.ok) throw new Error(`${method} ${path.replace(/\/previews\/.*/, "/previews/…")} on Cloudflare failed with ${response.status}: ${text.replace(/"text"\s*:\s*"[^"]*"/g, '"text":"…"').slice(0, 500)}`);
    return ((JSON.parse(text || "{}") as { result?: T }).result ?? null) as T | null;
  }
}
