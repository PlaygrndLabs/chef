import { DurableObject } from "cloudflare:workers";
import { directory, oauthClient, organization, type Env } from "./env.ts";
import { API, planFrom, randomToken, revokeRequest, type Granted, type Plan, type Profile } from "./oauth.ts";
import { engineName } from "./orgs.ts";
import { summary, Uninstaller } from "./uninstall.ts";

export interface Engine {
  readonly name: string;
  readonly url: string;
  readonly accountId: string;
  readonly secret: string;
  readonly version: string;
  readonly previews?: boolean;
}

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly plan: Plan;
  readonly subdomain: string | null;
}

export type StepId = "account" | "image" | "token" | "deploy";
export type StepState = "waiting" | "running" | "done" | "failed" | "skipped";

export interface InstallStatus {
  readonly orgId: string | null;
  readonly status: "idle" | "running" | "done" | "failed";
  readonly update: boolean;
  readonly steps: Readonly<Record<StepId, StepState>>;
  readonly log: readonly string[];
  readonly error: string | null;
}

export interface MemberView {
  readonly email: string | null;
  readonly admin: boolean;
  readonly canSetUp: boolean;
  readonly install: InstallStatus | null;
}

export interface OrgContext {
  readonly id: string;
  readonly canSetUp: boolean;
  readonly engine: Engine | null;
}

export interface InstallJob {
  readonly orgId: string;
  readonly orgName: string;
  readonly accountId: string;
  readonly engine: Engine | null;
}

export type RemoveStepId = "find" | "engine" | "apps" | "data" | "org";

export interface RemovalStatus {
  readonly orgId: string;
  readonly orgName: string;
  readonly personal: boolean;
  readonly accountId: string | null;
  readonly status: "running" | "done" | "failed";
  readonly steps: Readonly<Record<RemoveStepId, StepState>>;
  readonly log: readonly string[];
  readonly error: string | null;
  readonly left: readonly string[];
}

export interface RemovalJob {
  readonly orgId: string;
  readonly orgName: string;
  readonly personal: boolean;
  readonly engine: Engine | null;
  readonly projects: readonly string[] | null;
  readonly started?: boolean;
}

interface Job {
  readonly orgId: string;
  readonly name: string;
  readonly accountId: string;
  readonly secret: string;
  readonly update: boolean;
  readonly started?: boolean;
}

const PROFILE = "profile";
const TOKEN = "token";
const JOB = "job";
const STATUS = "status";
const ADMIN = "admin";
const REMOVAL_JOB = "removal-job";
const REMOVAL = "removal";
const TICKET = "backoffice-ticket";
const TICKET_MS = 60_000;
const MAX_LOG = 400;
const INSTANCE = "standard-2";

const FRESH: InstallStatus = { orgId: null, status: "idle", update: false, steps: { account: "waiting", image: "waiting", token: "waiting", deploy: "waiting" }, log: [], error: null };

interface Envelope<T> {
  readonly success?: boolean;
  readonly result?: T;
}

export class Member extends DurableObject<Env> {
  async signIn(profile: Profile, grant: Granted, admin: boolean, org: OrgContext, removing = false): Promise<void> {
    await this.ctx.storage.put(PROFILE, profile);
    await this.ctx.storage.put(TOKEN, grant);
    await this.ctx.storage.put(ADMIN, admin);
    const engine = org.engine;
    const running = (await this.status()).status === "running" || (await this.removal())?.status === "running";
    if (!running) await this.ctx.storage.delete(STATUS);
    if (removing && !running) {
      await this.ctx.storage.setAlarm(grant.expiresAt);
      return;
    }
    if (engine && !running && org.canSetUp && this.env.ENGINE_VERSION && (engine.version !== this.env.ENGINE_VERSION || engine.previews === false) && this.ready()) {
      await this.start({ orgId: org.id, name: engine.name, accountId: engine.accountId, secret: engine.secret, update: true });
      return;
    }
    if (engine && !running) {
      await this.forgetToken();
      return;
    }
    if (!running) await this.ctx.storage.setAlarm(grant.expiresAt);
  }

  async view(orgId: string): Promise<MemberView> {
    const profile = await this.ctx.storage.get<Profile>(PROFILE);
    const install = await this.status();
    return { email: profile?.email ?? null, admin: await this.admin(), canSetUp: (await this.grant()) !== null, install: install.status === "idle" || install.orgId !== orgId ? null : install };
  }

  async admin(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>(ADMIN)) === true;
  }

  async email(): Promise<string | null> {
    return (await this.ctx.storage.get<Profile>(PROFILE))?.email ?? null;
  }

  async backofficeTicket(): Promise<string> {
    const value = randomToken();
    await this.ctx.storage.put(TICKET, { value, expiresAt: Date.now() + TICKET_MS });
    return value;
  }

  async redeemTicket(value: string): Promise<boolean> {
    const ticket = await this.ctx.storage.get<{ value: string; expiresAt: number }>(TICKET);
    await this.ctx.storage.delete(TICKET);
    return ticket !== undefined && ticket.value === value && ticket.expiresAt > Date.now();
  }

  async accounts(): Promise<AccountView[] | null> {
    const grant = await this.grant();
    if (!grant) return null;
    const list = await this.cf<readonly { id: string; name: string }[]>(grant.token, "/accounts?per_page=50");
    return Promise.all(
      (list.result ?? []).map(async (account) => {
        const [subdomain, subscriptions] = await Promise.all([
          this.cf<{ subdomain?: string }>(grant.token, `/accounts/${account.id}/workers/subdomain`),
          this.cf<unknown>(grant.token, `/accounts/${account.id}/subscriptions`),
        ]);
        return {
          id: account.id,
          name: account.name,
          plan: subscriptions.success ? planFrom(subscriptions.result) : "unknown",
          subdomain: subdomain.result?.subdomain ?? null,
        };
      }),
    );
  }

  async install(request: InstallJob): Promise<InstallStatus | string> {
    const current = await this.status();
    if (current.status === "running") return current;
    if ((await this.removal())?.status === "running") return "chef is being removed; wait until that finishes";
    if (!this.ready()) return "setup is not available right now";
    const grant = await this.grant();
    if (!grant) return "your Cloudflare sign-in has ended; sign in again";
    const engine = request.engine?.accountId === request.accountId ? request.engine : null;
    if (engine) return this.start({ orgId: request.orgId, name: engine.name, accountId: request.accountId, secret: engine.secret, update: true });
    const scripts = await this.cf<readonly { id?: string }[]>(grant.token, `/accounts/${request.accountId}/workers/scripts`);
    if (!scripts.success) return "Cloudflare did not let chef look at this account; sign in again and share it on the consent page";
    const taken = new Set((scripts.result ?? []).flatMap((script) => (script.id ? [script.id] : [])));
    return this.start({ orgId: request.orgId, name: engineName(request.orgName, taken), accountId: request.accountId, secret: randomToken(), update: false });
  }

  async status(): Promise<InstallStatus> {
    return (await this.ctx.storage.get<InstallStatus>(STATUS)) ?? FRESH;
  }

  async dismiss(): Promise<void> {
    const status = await this.status();
    if (status.status !== "running") await this.ctx.storage.delete(STATUS);
  }

  async removal(): Promise<RemovalStatus | null> {
    return (await this.ctx.storage.get<RemovalStatus>(REMOVAL)) ?? null;
  }

  async dismissRemoval(): Promise<void> {
    if ((await this.removal())?.status !== "running") await this.ctx.storage.delete(REMOVAL);
  }

  async remove(job: RemovalJob): Promise<RemovalStatus | string> {
    const current = await this.removal();
    if (current?.status === "running") return current.orgId === job.orgId ? current : "chef is already removing another organization; wait until that finishes";
    if ((await this.status()).status === "running") return "chef is being set up; wait until that finishes";
    const status: RemovalStatus = {
      orgId: job.orgId,
      orgName: job.orgName,
      personal: job.personal,
      accountId: job.engine?.accountId ?? null,
      status: "running",
      steps: { find: "waiting", engine: "waiting", apps: "waiting", data: "waiting", org: "waiting" },
      log: [],
      error: null,
      left: [],
    };
    if (!job.engine) {
      await this.ctx.storage.put(REMOVAL, { ...status, steps: { find: "skipped", engine: "skipped", apps: "skipped", data: "skipped", org: "running" } });
      await this.removeRecords(job);
      await this.changeRemoval((s) => ({ ...s, status: "done", steps: { ...s.steps, org: "done" }, log: [...s.log, `removed ${job.orgName} from chef`] }));
      return (await this.removal()) as RemovalStatus;
    }
    if (!(await this.grant())) return "sign in with Cloudflare again so chef can reach your account";
    await this.ctx.storage.put(REMOVAL_JOB, job);
    await this.ctx.storage.put(REMOVAL, status);
    await organization(this.env, job.orgId).setRemoving(true);
    await this.ctx.storage.setAlarm(Date.now());
    return status;
  }

  override async alarm(): Promise<void> {
    const removal = await this.ctx.storage.get<RemovalJob>(REMOVAL_JOB);
    if (removal) {
      await this.ctx.storage.put(REMOVAL_JOB, { ...removal, started: true });
      try {
        if (removal.started) throw new Error("removing was interrupted by a chef update; sign in again and chef picks up where it stopped");
        await this.runRemoval(removal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.changeRemoval((s) => ({
          ...s,
          status: "failed",
          error: message,
          steps: Object.fromEntries(Object.entries(s.steps).map(([id, state]) => [id, state === "running" ? "failed" : state])) as RemovalStatus["steps"],
          log: [...s.log, message].slice(-MAX_LOG),
        }));
        await organization(this.env, removal.orgId).setRemoving(false).catch(() => undefined);
      }
      await this.ctx.storage.delete(REMOVAL_JOB);
    }
    const job = await this.ctx.storage.get<Job>(JOB);
    if (job?.started) {
      await this.ctx.storage.delete(JOB);
      await this.update((s) => ({ ...s, status: "failed", error: s.error ?? "setup was interrupted by a chef update; sign in and try again" }));
      await this.report(job);
    } else if (job) {
      await this.ctx.storage.put(JOB, { ...job, started: true });
      try {
        await this.run(job);
      } catch (error) {
        await this.update((s) => ({ ...s, status: "failed", error: s.error ?? (error instanceof Error ? error.message : String(error)) }));
      }
      await this.ctx.storage.delete(JOB);
      await this.report(job);
    }
    await this.forgetToken();
  }

  private async runRemoval(job: RemovalJob): Promise<void> {
    const engine = job.engine as Engine;
    const grant = await this.grant();
    if (!grant) throw new Error("your Cloudflare sign-in ended before chef could start; sign in again");
    const log = (line: string) => this.changeRemoval((s) => ({ ...s, log: [...s.log, redact(line)].slice(-MAX_LOG) }));
    const mark = (id: RemoveStepId, state: StepState) => this.changeRemoval((s) => ({ ...s, steps: { ...s.steps, [id]: state } }));
    await mark("find", "running");
    const tool = new Uninstaller(grant.token, {
      accountId: engine.accountId,
      engine: engine.name,
      projects: job.projects,
      ownAccount: engine.accountId === this.env.CF_ACCOUNT_ID,
    });
    const found = await tool.find();
    const plan = summary(found, engine.name);
    await log(plan.length > 0 ? `found what chef made for ${job.orgName} on Cloudflare account ${engine.accountId}:` : `chef found nothing of its own left on Cloudflare account ${engine.accountId}`);
    for (const line of plan) await log(`  ${line}`);
    await mark("find", "done");
    let current: RemoveStepId | null = null;
    const outcome = await tool.remove(found, (line) => void log(line), async (id) => {
      if (current) await mark(current, "done");
      current = id;
      await mark(id, "running");
    });
    await this.flush();
    if (outcome.failed.length > 0) throw new Error(`chef could not remove everything yet: ${outcome.failed.join("; ")}. Nothing outside ${job.orgName} was touched. Sign in and try again; chef picks up where it stopped.`);
    if (current) await mark(current, "done");
    await mark("org", "running");
    await this.removeRecords(job);
    await this.changeRemoval((s) => ({ ...s, status: "done", left: outcome.left, steps: { ...s.steps, org: "done" }, log: [...s.log, job.personal ? "Personal is ready to set chef up again" : `removed ${job.orgName} from chef`] }));
  }

  private async removeRecords(job: RemovalJob): Promise<void> {
    const org = organization(this.env, job.orgId);
    if (job.personal) {
      await org.reset();
      await directory(this.env).recordSetup(job.orgId, { accountId: null, engine: null, version: null, install: "idle", error: null });
    } else {
      await org.erase();
      await directory(this.env).deleteOrg(job.orgId);
    }
  }

  private pending: Promise<void> = Promise.resolve();

  private changeRemoval(change: (status: RemovalStatus) => RemovalStatus): Promise<void> {
    this.pending = this.pending.then(async () => {
      const current = await this.removal();
      if (current) await this.ctx.storage.put(REMOVAL, change(current));
    }).catch(() => undefined);
    return this.pending;
  }

  private flush(): Promise<void> {
    return this.pending;
  }

  private ready(): boolean {
    return Boolean(this.env.SANDBOX_IMAGE && this.env.CF_ACCOUNT_ID && this.env.CF_API_TOKEN);
  }

  private async start(job: Job): Promise<InstallStatus> {
    const status: InstallStatus = { ...FRESH, orgId: job.orgId, status: "running", update: job.update };
    await this.ctx.storage.put(JOB, job);
    await this.ctx.storage.put(STATUS, status);
    await this.ctx.storage.setAlarm(Date.now());
    await this.report(job);
    return status;
  }

  private async report(job: Job): Promise<void> {
    const status = await this.status();
    const engine = await organization(this.env, job.orgId).engine().catch(() => null);
    await directory(this.env)
      .recordSetup(job.orgId, {
        accountId: job.accountId,
        engine: engine?.url ?? null,
        version: engine?.version ?? null,
        install: status.status === "idle" && engine ? "done" : status.status,
        error: status.status === "failed" ? status.error : null,
      })
      .catch(() => undefined);
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
    const payload = { accountId: job.accountId, name: job.name, password: job.secret, site: this.env.SITE_URL ?? null, token: grant.token, source: { image: this.env.SANDBOX_IMAGE, ...source } };
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
    const previews = (await this.status()).steps.token !== "skipped";
    await organization(this.env, job.orgId).setEngine({ name: job.name, url, accountId: job.accountId, secret: job.secret, version: this.env.ENGINE_VERSION ?? "", previews } satisfies Engine);
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
