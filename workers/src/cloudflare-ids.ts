export interface EngineIds {
  readonly namespaces: Partial<Record<"ProjectAgent" | "SessionAgent", string>>;
  readonly containerApp: string | null;
}

const NONE: EngineIds = { namespaces: {}, containerApp: null };
const KEEP_MS = 10 * 60_000;

export function containerAppName(engine: string): string {
  return `${engine}-sessionagent`;
}

export class EngineIdCache {
  private cached: { readonly at: number; readonly ids: EngineIds } | null = null;

  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  async ids(grant: { readonly accountId: string; readonly apiToken: string } | null, engine: string, now = Date.now()): Promise<EngineIds> {
    if (!grant) return NONE;
    if (this.cached && now - this.cached.at < KEEP_MS) return this.cached.ids;
    const [namespaces, apps] = await Promise.all([
      this.get<readonly { id?: string; script?: string; class?: string }[]>(grant, "/workers/durable_objects/namespaces?per_page=1000"),
      this.get<readonly { id?: string; name?: string }[]>(grant, "/containers/applications"),
    ]);
    const ids: EngineIds = {
      namespaces: Object.fromEntries((namespaces ?? []).filter((n) => n.script === engine && (n.class === "ProjectAgent" || n.class === "SessionAgent") && n.id).map((n) => [n.class, n.id])),
      containerApp: (apps ?? []).find((a) => a.name === containerAppName(engine))?.id ?? null,
    };
    this.cached = { at: now, ids };
    return ids;
  }

  private async get<T>(grant: { readonly accountId: string; readonly apiToken: string }, path: string): Promise<T | null> {
    try {
      const response = await this.fetcher(`https://api.cloudflare.com/client/v4/accounts/${grant.accountId}${path}`, { headers: { authorization: `Bearer ${grant.apiToken}` } });
      if (!response.ok) return null;
      return ((await response.json()) as { result?: T }).result ?? null;
    } catch {
      return null;
    }
  }
}
