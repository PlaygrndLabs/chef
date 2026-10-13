import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_NAME, deploy, wranglerRunner, type Deployed, type DeployOptions } from "./deploy.ts";

const API = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

export interface CloudflareAccount {
  readonly accountId: string;
  readonly apiToken: string;
}

export type CloudflareCheck = { readonly ok: true; readonly deployed: boolean; readonly url: string | null } | { readonly ok: false; readonly error: string };

interface Envelope<T> {
  readonly success?: boolean;
  readonly result?: T;
  readonly errors?: readonly { readonly message?: string }[];
}

export function readAccount(body: unknown): CloudflareAccount | string {
  const input = (body ?? {}) as { accountId?: unknown; apiToken?: unknown };
  const accountId = typeof input.accountId === "string" ? input.accountId.trim() : "";
  const apiToken = typeof input.apiToken === "string" ? input.apiToken.trim() : "";
  if (!ACCOUNT_ID.test(accountId)) return "the account id is 32 hexadecimal characters; it is on the right of your Cloudflare dashboard's Workers page";
  if (!apiToken) return "enter an API token";
  return { accountId, apiToken };
}

export async function checkCloudflare(account: CloudflareAccount, fetchImpl: typeof fetch = fetch, name: string = BASE_NAME): Promise<CloudflareCheck> {
  const get = async <T>(path: string): Promise<{ status: number; body: Envelope<T> }> => {
    const response = await fetchImpl(`${API}/accounts/${account.accountId}${path}`, { headers: { authorization: `Bearer ${account.apiToken}` } });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Envelope<T> };
  };
  let scripts: { status: number; body: Envelope<readonly { readonly id?: string }[]> };
  try {
    scripts = await get<readonly { readonly id?: string }[]>("/workers/scripts");
  } catch {
    return { ok: false, error: "could not reach Cloudflare" };
  }
  if (scripts.status === 401 || scripts.status === 403 || !scripts.body.success) {
    const reason = scripts.body.errors?.[0]?.message;
    return { ok: false, error: `Cloudflare refused this token for that account${reason ? `: ${reason}` : ""}. It needs permission to edit Workers in the account.` };
  }
  const deployed = (scripts.body.result ?? []).some((script) => script.id === name);
  const subdomain = await get<{ readonly subdomain?: string }>("/workers/subdomain").catch(() => null);
  const host = subdomain?.body.result?.subdomain;
  return { ok: true, deployed, url: host ? `https://${name}.${host}.workers.dev` : null };
}

export interface SetupState {
  readonly status: "idle" | "running" | "done" | "failed";
  readonly log: readonly string[];
  readonly url: string | null;
  readonly error: string | null;
}

export const IDLE: SetupState = { status: "idle", log: [], url: null, error: null };

export type Deployer = (account: CloudflareAccount, secrets: Readonly<Record<string, string>>, log: (line: string) => void) => Promise<Deployed>;

export const deployFromHere: Deployer = async (account, secrets, log) => {
  const dir = mkdtempSync(join(tmpdir(), "chef-deploy-"));
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  try {
    const options: DeployOptions = {
      run: wranglerRunner(undefined, { env: { CLOUDFLARE_API_TOKEN: account.apiToken, CLOUDFLARE_ACCOUNT_ID: account.accountId, WRANGLER_SEND_METRICS: "false", CI: "true" }, onLine: log }),
      passthrough: ["--secrets-file", file],
      log,
    };
    return await deploy(options);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
