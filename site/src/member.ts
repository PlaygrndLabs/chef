import { DurableObject } from "cloudflare:workers";
import { oauthClient, type Env } from "./env.ts";
import { API, planFrom, randomToken, revokeRequest, type Granted, type InstallRequest, type Plan, type Profile } from "./oauth.ts";

export interface Engine {
  readonly url: string;
  readonly accountId: string;
  readonly secret: string;
  readonly version: string;
}

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly plan: Plan;
  readonly hasChef: boolean;
  readonly subdomain: string | null;
}

export type StepId = "account" | "image" | "token" | "deploy";
export type StepState = "waiting" | "running" | "done" | "failed" | "skipped";

export interface InstallStatus {
  readonly status: "idle" | "running" | "done" | "failed";
  readonly update: boolean;
  readonly steps: Readonly<Record<StepId, StepState>>;
  readonly log: readonly string[];
  readonly error: string | null;
}

export interface MemberView {
  readonly email: string | null;
  readonly engine: string | null;
  readonly canSetUp: boolean;
  readonly install: InstallStatus | null;
}

interface Job {
  readonly accountId: string;
  readonly secret: string;
  readonly update: boolean;
}

const PROFILE = "profile";
const ENGINE = "engine";
const TOKEN = "token";
const JOB = "job";
const STATUS = "status";
const MAX_LOG = 400;
const INSTANCE = "standard-2";

const FRESH: InstallStatus = { status: "idle", update: false, steps: { account: "waiting", image: "waiting", token: "waiting", deploy: "waiting" }, log: [], error: null };

interface Envelope<T> {
  readonly success?: boolean;
  readonly result?: T;
}

export class Member extends DurableObject<Env> {
  async signIn(profile: Profile, grant: Granted): Promise<void> {
    await this.ctx.storage.put(PROFILE, profile);
    await this.ctx.storage.put(TOKEN, grant);
    const engine = await this.ctx.storage.get<Engine>(ENGINE);
    const running = (await this.status()).status === "running";
    if (!running) await this.ctx.storage.delete(STATUS);
    if (engine && !running && this.env.ENGINE_VERSION && engine.version !== this.env.ENGINE_VERSION && this.ready()) {
      await this.start({ accountId: engine.accountId, secret: engine.secret, update: true });
      return;
    }
    if (engine && !running) {
      await this.forgetToken();
      return;
    }
    if (!running) await this.ctx.storage.setAlarm(grant.expiresAt);
  }

  async view(): Promise<MemberView> {
    const profile = await this.ctx.storage.get<Profile>(PROFILE);
    const engine = await this.ctx.storage.get<Engine>(ENGINE);
    const install = await this.status();
    return { email: profile?.email ?? null, engine: engine?.url ?? null, canSetUp: (await this.grant()) !== null, install: install.status === "idle" ? null : install };
  }

  async engine(): Promise<Engine | null> {
    return (await this.ctx.storage.get<Engine>(ENGINE)) ?? null;
  }

  async accounts(): Promise<AccountView[] | null> {
    const grant = await this.grant();
    if (!grant) return null;
    const list = await this.cf<readonly { id: string; name: string }[]>(grant.token, "/accounts?per_page=50");
    return Promise.all(
      (list.result ?? []).map(async (account) => {
        const [scripts, subdomain, subscriptions] = await Promise.all([
          this.cf<readonly { id?: string }[]>(grant.token, `/accounts/${account.id}/workers/scripts`),
          this.cf<{ subdomain?: string }>(grant.token, `/accounts/${account.id}/workers/subdomain`),
          this.cf<unknown>(grant.token, `/accounts/${account.id}/subscriptions`),
        ]);
        return {
          id: account.id,
          name: account.name,
          plan: subscriptions.success ? planFrom(subscriptions.result) : "unknown",
          hasChef: (scripts.result ?? []).some((script) => script.id === "chef"),
          subdomain: subdomain.result?.subdomain ?? null,
        };
      }),
    );
  }

  async install(request: InstallRequest): Promise<InstallStatus | string> {
    if (!(await this.grant())) return "your Cloudflare sign-in has ended; sign in again";
    const current = await this.status();
    if (current.status === "running") return current;
    if (!this.ready()) return "setup is not available right now";
    const engine = await this.ctx.storage.get<Engine>(ENGINE);
    const update = engine?.accountId === request.accountId;
    return this.start({ accountId: request.accountId, secret: update && engine ? engine.secret : randomToken(), update });
  }

  async status(): Promise<InstallStatus> {
    return (await this.ctx.storage.get<InstallStatus>(STATUS)) ?? FRESH;
  }

  async dismiss(): Promise<void> {
    const status = await this.status();
    if (status.status !== "running") await this.ctx.storage.delete(STATUS);
  }

  override async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<Job>(JOB);
    if (job) {
      await this.ctx.storage.delete(JOB);
      try {
        await this.run(job);
      } catch (error) {
        await this.update((s) => ({ ...s, status: "failed", error: s.error ?? (error instanceof Error ? error.message : String(error)) }));
      }
    }
    await this.forgetToken();
  }

  private ready(): boolean {
    return Boolean(this.env.SANDBOX_IMAGE && this.env.CF_ACCOUNT_ID && this.env.CF_API_TOKEN);
  }

  private async start(job: Job): Promise<InstallStatus> {
    const status: InstallStatus = { ...FRESH, status: "running", update: job.update };
    await this.ctx.storage.put(JOB, job);
    await this.ctx.storage.put(STATUS, status);
    await this.ctx.storage.setAlarm(Date.now());
    return status;
  }

  private async run(job: Job): Promise<void> {
    const grant = await this.grant();
    if (!grant) throw new Error("your Cloudflare sign-in ended before setup started; sign in again");
    const source = await this.sourceCredentials();
    const container = this.ctx.container;
    if (!container) throw new Error("the installer is not configured");
    if (!container.running) {
      let exited: string | null = null;
      container.start({ image: container.images["installer"] as string, enableInternet: true, instance: INSTANCE });
      container.monitor().catch((error: unknown) => (exited = String(error)));
      for (let waited = 0; !container.running && !exited && waited < 90_000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
      if (!container.running) throw new Error(`the installer did not start${exited ? `: ${exited}` : ""}`);
    }
    const payload = { accountId: job.accountId, name: "chef", password: job.secret, token: grant.token, source: { image: this.env.SANDBOX_IMAGE, ...source } };
    let url: string | null = null;
    try {
      const process = await container.exec(["node", "/opt/chef/site/installer/install.mjs"], { env: { CHEF_JOB: toBase64(JSON.stringify(payload)) }, stdout: "pipe", stderr: "combined" });
      const lines = (process.stdout as ReadableStream<Uint8Array>).pipeThrough(new TextDecoderStream()).pipeThrough(splitLines());
      for await (const line of lines) url = (await this.take(line)) ?? url;
      const code = await process.exitCode;
      if (code !== 0 || !url) throw new Error((await this.status()).error ?? `the installer stopped with code ${code}`);
    } finally {
      await container.destroy().catch(() => undefined);
    }
    await this.ctx.storage.put(ENGINE, { url, accountId: job.accountId, secret: job.secret, version: this.env.ENGINE_VERSION ?? "" } satisfies Engine);
    await this.update((s) => ({ ...s, status: "done" }));
  }

  private async take(line: string): Promise<string | null> {
    let event: { type?: string; id?: StepId; state?: StepState; line?: string; url?: string; message?: string };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      event = { type: "log", line };
    }
    await this.update((s) => {
      if (event.type === "step" && event.id && event.state) return { ...s, steps: { ...s.steps, [event.id]: event.state } };
      if (event.type === "error") return { ...s, error: event.message ?? "setup failed" };
      if (event.type === "done") return s;
      return { ...s, log: [...s.log, redact(event.line ?? line)].slice(-MAX_LOG) };
    });
    return event.type === "done" && event.url ? event.url : null;
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
    if (!grant) return;
    await this.ctx.storage.delete(TOKEN);
    const client = oauthClient(this.env);
    if (client) await fetch(revokeRequest(client, grant.token)).catch(() => undefined);
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
