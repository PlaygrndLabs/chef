import { DurableObject } from "cloudflare:workers";
import { oauthClient, type Env } from "./env.ts";
import { API, planFrom, revokeRequest, type Granted, type InstallRequest, type Plan } from "./oauth.ts";

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly plan: Plan;
  readonly chefUrl: string | null;
  readonly subdomain: string | null;
}

export type StepId = "account" | "image" | "token" | "deploy";
export type StepState = "waiting" | "running" | "done" | "failed" | "skipped";

export interface InstallStatus {
  readonly status: "idle" | "running" | "done" | "failed";
  readonly steps: Readonly<Record<StepId, StepState>>;
  readonly log: readonly string[];
  readonly url: string | null;
  readonly error: string | null;
}

const TOKEN = "token";
const JOB = "job";
const STATUS = "status";
const MAX_LOG = 400;
const INSTANCE = "standard-2";
const KEEP_STATUS_MS = 3_600_000;

const FRESH: InstallStatus = { status: "idle", steps: { account: "waiting", image: "waiting", token: "waiting", deploy: "waiting" }, log: [], url: null, error: null };

interface Envelope<T> {
  readonly success?: boolean;
  readonly result?: T;
  readonly errors?: readonly { readonly message?: string }[];
}

export class Setup extends DurableObject<Env> {
  async begin(grant: Granted): Promise<void> {
    await this.ctx.storage.put(TOKEN, grant);
    await this.ctx.storage.setAlarm(grant.expiresAt);
  }

  async signedIn(): Promise<boolean> {
    return (await this.grant()) !== null;
  }

  async accounts(): Promise<AccountView[] | null> {
    const grant = await this.grant();
    if (!grant) return null;
    const list = await this.cf<readonly { id: string; name: string }[]>(grant.token, "/accounts?per_page=50");
    const accounts = list.result ?? [];
    return Promise.all(
      accounts.map(async (account) => {
        const [scripts, subdomain, subscriptions] = await Promise.all([
          this.cf<readonly { id?: string }[]>(grant.token, `/accounts/${account.id}/workers/scripts`),
          this.cf<{ subdomain?: string }>(grant.token, `/accounts/${account.id}/workers/subdomain`),
          this.cf<unknown>(grant.token, `/accounts/${account.id}/subscriptions`),
        ]);
        const host = subdomain.result?.subdomain ?? null;
        const hasChef = (scripts.result ?? []).some((script) => script.id === "chef");
        return { id: account.id, name: account.name, plan: subscriptions.success ? planFrom(subscriptions.result) : "unknown", subdomain: host, chefUrl: hasChef && host ? `https://chef.${host}.workers.dev` : null };
      }),
    );
  }

  async install(request: InstallRequest): Promise<InstallStatus | string> {
    if (!(await this.grant())) return "your Cloudflare sign-in has ended; sign in again";
    const current = await this.status();
    if (current.status === "running") return current;
    if (!this.env.SANDBOX_IMAGE || !this.env.CF_ACCOUNT_ID || !this.env.CF_API_TOKEN) return "setup is not available right now";
    const status: InstallStatus = { ...FRESH, status: "running" };
    await this.ctx.storage.put(JOB, request);
    await this.ctx.storage.put(STATUS, status);
    await this.ctx.storage.setAlarm(Date.now());
    return status;
  }

  async status(): Promise<InstallStatus> {
    return (await this.ctx.storage.get<InstallStatus>(STATUS)) ?? FRESH;
  }

  async end(): Promise<void> {
    const running = (await this.status()).status === "running";
    if (!running) await this.forget();
  }

  override async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<InstallRequest>(JOB);
    if (job) {
      await this.ctx.storage.delete(JOB);
      try {
        await this.run(job);
      } catch (error) {
        await this.update((s) => ({ ...s, status: "failed", error: s.error ?? (error instanceof Error ? error.message : String(error)) }));
      }
      await this.forgetToken();
      await this.ctx.storage.setAlarm(Date.now() + KEEP_STATUS_MS);
      return;
    }
    await this.forget();
  }

  private async run(job: InstallRequest): Promise<void> {
    const grant = await this.grant();
    if (!grant) throw new Error("your Cloudflare sign-in ended before setup started; sign in again");
    const source = await this.sourceCredentials();
    const container = this.ctx.container;
    if (!container) throw new Error("the installer is not configured");
    if (!container.running) {
      container.start({ image: container.images["installer"] as string, enableInternet: true, instance: INSTANCE });
      let exited: string | null = null;
      container.monitor().catch((error: unknown) => (exited = String(error)));
      for (let waited = 0; !container.running && !exited && waited < 90_000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
      if (!container.running) throw new Error(`the installer did not start${exited ? `: ${exited}` : ""}`);
    }
    const payload = { accountId: job.accountId, name: job.name, password: job.password, token: grant.token, source: { image: this.env.SANDBOX_IMAGE, ...source } };
    const process = await container.exec(["node", "/opt/chef/site/installer/install.mjs"], { env: { CHEF_JOB: toBase64(JSON.stringify(payload)) }, stdout: "pipe", stderr: "combined" });
    const lines = (process.stdout as ReadableStream<Uint8Array>).pipeThrough(new TextDecoderStream()).pipeThrough(splitLines());
    for await (const line of lines) await this.take(line);
    const code = await process.exitCode;
    await this.update((s) => (s.status === "running" ? { ...s, status: code === 0 && s.url ? "done" : "failed", error: s.error ?? (code === 0 ? null : `the installer stopped with code ${code}`) } : s));
    await container.destroy().catch(() => undefined);
  }

  private async take(line: string): Promise<void> {
    let event: { type?: string; id?: StepId; state?: StepState; line?: string; url?: string; message?: string };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      event = { type: "log", line };
    }
    await this.update((s) => {
      if (event.type === "step" && event.id && event.state) return { ...s, steps: { ...s.steps, [event.id]: event.state } };
      if (event.type === "done" && event.url) return { ...s, status: "done", url: event.url };
      if (event.type === "error") return { ...s, status: "failed", error: event.message ?? "setup failed" };
      return { ...s, log: [...s.log, redact(event.line ?? line)].slice(-MAX_LOG) };
    });
  }

  private async update(change: (status: InstallStatus) => InstallStatus): Promise<void> {
    await this.ctx.storage.put(STATUS, change(await this.status()));
  }

  private async sourceCredentials(): Promise<{ username: string; password: string }> {
    const response = await fetch(`${API}/accounts/${this.env.CF_ACCOUNT_ID}/containers/registries/registry.cloudflare.com/credentials`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.env.CF_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ expiration_minutes: 30, permissions: ["pull"] }),
    });
    const body = (await response.json().catch(() => ({}))) as Envelope<{ username?: string; password?: string }> & { username?: string; password?: string };
    const creds = body.result ?? body;
    if (!response.ok || !creds.username || !creds.password) throw new Error("could not prepare the chef image; try again in a minute");
    return { username: creds.username, password: creds.password };
  }

  private async grant(): Promise<Granted | null> {
    const grant = await this.ctx.storage.get<Granted>(TOKEN);
    return grant && grant.expiresAt > Date.now() ? grant : null;
  }

  private async forgetToken(): Promise<void> {
    const grant = await this.ctx.storage.get<Granted>(TOKEN);
    await this.ctx.storage.delete(TOKEN);
    const client = oauthClient(this.env);
    if (grant && client) await fetch(revokeRequest(client, grant.token)).catch(() => undefined);
  }

  private async forget(): Promise<void> {
    await this.forgetToken();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private async cf<T>(token: string, path: string): Promise<Envelope<T>> {
    const response = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!response) return { success: false };
    return (await response.json().catch(() => ({ success: false }))) as Envelope<T>;
  }
}

function redact(line: string): string {
  return line.replace(/(Bearer\s+|password["':=\s]+)[^\s"']+/gi, "$1…");
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function splitLines(): TransformStream<string, string> {
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) if (part.trim()) controller.enqueue(part);
    },
    flush(controller) {
      if (buffer.trim()) controller.enqueue(buffer);
    },
  });
}
