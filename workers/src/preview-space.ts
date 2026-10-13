import type { PreviewSpace } from "@chef/core";

export class CloudflareWorkerSpace implements PreviewSpace {
  constructor(
    private readonly grant: { readonly accountId: string; readonly worker: string },
    private readonly apiToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async remove(): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.grant.accountId}/workers/scripts/${encodeURIComponent(this.grant.worker)}?force=true`;
    const response = await this.fetcher(url, { method: "DELETE", headers: { authorization: `Bearer ${this.apiToken}` } });
    if (response.ok || response.status === 404) return;
    const body = await response.text().catch(() => "");
    throw new Error(`deleting the preview Worker ${this.grant.worker} failed with ${response.status}: ${body.slice(0, 500)}`);
  }
}
