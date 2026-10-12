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

export function buildingPage(input: { readonly status: "building" | "failed" | "missing"; readonly key: string; readonly error?: string }): Response {
  const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const title = input.status === "building" ? "Waking up this preview" : input.status === "failed" ? "This preview could not start" : "No preview yet";
  const detail =
    input.status === "building"
      ? "It was asleep to save resources. chef is building it again from the latest commit of this feature. The page opens by itself when it is ready."
      : input.status === "failed"
        ? `chef tried to build it and got this error:<pre>${escape(input.error ?? "")}</pre><a href="?retry=1">Try again</a>`
        : "This feature has no preview branch yet.";
  const refresh = input.status === "building" ? '<meta http-equiv="refresh" content="4">' : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}<title>${title}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fafafa;color:#18181b}main{max-width:32rem;padding:24px}h1{font-size:18px}pre{white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:8px;font-size:12px}@media (prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}pre{background:#27272a}}</style></head><body><main><h1>${title}</h1><p>${detail}</p><p><small>${escape(input.key)}</small></p></main></body></html>`;
  return new Response(html, { status: input.status === "missing" ? 404 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
