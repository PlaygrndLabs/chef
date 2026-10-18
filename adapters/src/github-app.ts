export interface GitHubAppCredentials {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly owner: string;
  readonly htmlUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly webhookSecret: string;
  readonly pem: string;
}

export interface GitHubAppView {
  readonly slug: string;
  readonly name: string;
  readonly owner: string;
  readonly htmlUrl: string;
  readonly installUrl: string;
}

export interface InstalledRepository {
  readonly fullName: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly installation: number;
}

export interface GitHubAppOptions {
  readonly fetcher?: typeof fetch;
  readonly api?: string;
  readonly now?: () => number;
}

const GITHUB = "https://github.com";
const API = "https://api.github.com";
const TOKEN_MARGIN_MS = 5 * 60_000;
const NAME_LIMIT = 34;

export function appManifest(origin: string, name: string, publicOrigin: string = origin) {
  return {
    name,
    url: publicOrigin,
    description: `Lets chef at ${new URL(publicOrigin).host} take in pushes from your repositories and send finished work back as branches and pull requests.`,
    hook_attributes: { url: `${origin}/api/github/webhook`, active: true },
    redirect_url: `${publicOrigin}/api/github/created`,
    setup_url: `${publicOrigin}/api/github/installed`,
    setup_on_update: true,
    public: false,
    default_permissions: { contents: "write", pull_requests: "write", metadata: "read" },
    default_events: ["push"],
  };
}

export function appName(host: string, suffix: string): string {
  const label = host.split(".").filter((part) => part !== "chef" && part !== "workers" && part !== "dev").slice(0, 1)[0] ?? "self";
  const base = `chef-${label.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, NAME_LIMIT - suffix.length - 1);
  return `${base}-${suffix}`;
}

export function manifestAction(organization: string | null, state: string): string {
  const path = organization ? `/organizations/${encodeURIComponent(organization)}/settings/apps/new` : "/settings/apps/new";
  return `${GITHUB}${path}?state=${encodeURIComponent(state)}`;
}

export function installUrl(app: Pick<GitHubAppCredentials, "slug">, state?: string): string {
  return `${GITHUB}/apps/${app.slug}/installations/new${state ? `?state=${encodeURIComponent(state)}` : ""}`;
}

export function viewApp(app: GitHubAppCredentials): GitHubAppView {
  return { slug: app.slug, name: app.name, owner: app.owner, htmlUrl: app.htmlUrl, installUrl: installUrl(app) };
}

const headers = (auth: string) => ({ authorization: auth, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "chef" });

async function failed(response: Response, what: string): Promise<Error> {
  return new Error(`${what} failed with ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

export async function convertManifest(code: string, options: GitHubAppOptions = {}): Promise<GitHubAppCredentials> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(`${options.api ?? API}/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST", headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "chef" } });
  if (!response.ok) throw await failed(response, "creating the GitHub App");
  const app = (await response.json()) as { id: number; slug: string; name: string; owner: { login: string } | null; html_url: string; client_id: string; client_secret: string; webhook_secret: string; pem: string };
  return { id: app.id, slug: app.slug, name: app.name, owner: app.owner?.login ?? "", htmlUrl: app.html_url, clientId: app.client_id, clientSecret: app.client_secret, webhookSecret: app.webhook_secret, pem: app.pem };
}

function der(tag: number, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = body.length;
  const size = length < 0x80 ? [length] : length < 0x100 ? [0x81, length] : length < 0x10000 ? [0x82, length >> 8, length & 0xff] : [0x83, length >> 16, (length >> 8) & 0xff, length & 0xff];
  const out = new Uint8Array(1 + size.length + length);
  out[0] = tag;
  out.set(size, 1);
  out.set(body, 1 + size.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const RSA_ALGORITHM = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);

export function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const base64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (!pkcs1) return bytes;
  return der(0x30, concat(new Uint8Array([0x02, 0x01, 0x00]), RSA_ALGORITHM, der(0x04, bytes)));
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

export async function appJwt(app: Pick<GitHubAppCredentials, "id" | "pem">, nowMs: number): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(app.pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(nowMs / 1000);
  const unsigned = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson({ iat: now - 60, exp: now + 540, iss: String(app.id) })}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${base64url(signature)}`;
}

const tokens = new Map<string, { readonly token: string; readonly expires: number }>();

export interface GitHubBroker {
  readonly url: string;
  readonly key: string;
}

export abstract class GitHubAccess {
  protected readonly fetcher: typeof fetch;
  protected readonly api: string;
  protected readonly now: () => number;

  constructor(options: GitHubAppOptions = {}) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.api = options.api ?? API;
    this.now = options.now ?? Date.now;
  }

  abstract readonly identity: string;
  abstract installations(): Promise<number[]>;
  abstract installationToken(installation: number): Promise<string>;

  async repositories(): Promise<InstalledRepository[]> {
    const found: InstalledRepository[] = [];
    for (const installation of await this.installations()) {
      const token = await this.installationToken(installation);
      for (let page = 1; page <= 10; page++) {
        const response = await this.fetcher(`${this.api}/installation/repositories?per_page=100&page=${page}`, { headers: headers(`token ${token}`) });
        if (!response.ok) throw await failed(response, "listing repositories");
        const body = (await response.json()) as { total_count: number; repositories: { full_name: string; html_url: string; default_branch: string; private: boolean }[] };
        for (const r of body.repositories) found.push({ fullName: r.full_name, url: r.html_url, defaultBranch: r.default_branch, private: r.private, installation });
        if (body.repositories.length < 100 || found.length >= body.total_count) break;
      }
    }
    return found.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async installationFor(owner: string, repo: string): Promise<number | null> {
    const name = `${owner}/${repo}`.toLowerCase();
    return (await this.repositories()).find((r) => r.fullName.toLowerCase() === name)?.installation ?? null;
  }

  protected cachedToken(key: string): string | null {
    const cached = tokens.get(key);
    return cached && cached.expires - TOKEN_MARGIN_MS > this.now() ? cached.token : null;
  }
}

export class GitHubApp extends GitHubAccess {
  readonly identity: string;

  constructor(
    readonly credentials: GitHubAppCredentials,
    options: GitHubAppOptions = {},
  ) {
    super(options);
    this.identity = `app:${credentials.id}`;
  }

  private async asApp(path: string, init: RequestInit = {}): Promise<Response> {
    const jwt = await appJwt(this.credentials, this.now());
    return this.fetcher(`${this.api}${path}`, { ...init, headers: headers(`Bearer ${jwt}`) });
  }

  async installationToken(installation: number): Promise<string> {
    const key = `${this.identity}:${installation}`;
    const cached = this.cachedToken(key);
    if (cached) return cached;
    const response = await this.asApp(`/app/installations/${installation}/access_tokens`, { method: "POST" });
    if (!response.ok) throw await failed(response, "getting a GitHub access token");
    const body = (await response.json()) as { token: string; expires_at: string };
    tokens.set(key, { token: body.token, expires: Date.parse(body.expires_at) });
    return body.token;
  }

  async installations(): Promise<number[]> {
    const response = await this.asApp("/app/installations?per_page=100");
    if (!response.ok) throw await failed(response, "listing the app's installations");
    return ((await response.json()) as { id: number }[]).map((i) => i.id);
  }
}

export class BrokeredGitHub extends GitHubAccess {
  readonly identity: string;

  constructor(
    readonly broker: GitHubBroker,
    options: GitHubAppOptions = {},
  ) {
    super(options);
    this.identity = `broker:${broker.url}:${broker.key.slice(-8)}`;
  }

  private call(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetcher(`${this.broker.url}${path}`, { ...init, headers: { ...headers(`Bearer ${this.broker.key}`), "content-type": "application/json" } });
  }

  async describe(): Promise<{ readonly app: GitHubAppView; readonly installations: number[] }> {
    const response = await this.call("");
    if (!response.ok) throw await failed(response, "asking the shared GitHub app what it can reach");
    return readShared(await response.json());
  }

  async installations(): Promise<number[]> {
    return (await this.describe()).installations;
  }

  async installationToken(installation: number): Promise<string> {
    const key = `${this.identity}:${installation}`;
    const cached = this.cachedToken(key);
    if (cached) return cached;
    const response = await this.call("/token", { method: "POST", body: JSON.stringify({ installation }) });
    if (!response.ok) throw await failed(response, "getting a GitHub access token");
    const body = (await response.json()) as { token?: unknown; expiresAt?: unknown };
    if (typeof body.token !== "string" || typeof body.expiresAt !== "string") throw new Error("the shared GitHub app answered without a token");
    tokens.set(key, { token: body.token, expires: Date.parse(body.expiresAt) });
    return body.token;
  }
}

function readShared(body: unknown): { readonly app: GitHubAppView; readonly installations: number[] } {
  const input = (body ?? {}) as { app?: Record<string, unknown>; installations?: unknown };
  const app = input.app ?? {};
  const text = (key: string) => (typeof app[key] === "string" ? (app[key] as string) : "");
  if (!text("slug") || !text("installUrl")) throw new Error("the shared GitHub app answered without its name");
  const installations = Array.isArray(input.installations) ? input.installations.filter((id): id is number => Number.isInteger(id) && (id as number) > 0) : [];
  return { app: { slug: text("slug"), name: text("name") || text("slug"), owner: text("owner"), htmlUrl: text("htmlUrl"), installUrl: text("installUrl") }, installations };
}

export function readBroker(body: unknown): GitHubBroker | string {
  const input = (body ?? {}) as { url?: unknown; key?: unknown };
  if (typeof input.url !== "string" || typeof input.key !== "string") return "send the url and key of the shared GitHub app";
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return "that url is not a web address";
  }
  if (url.protocol !== "https:" || url.search || url.hash) return "the url must be a plain https address";
  const key = input.key.trim();
  if (key.length < 16 || key.length > 300) return "the key must be 16 to 300 characters";
  return { url: url.toString().replace(/\/$/, ""), key };
}
