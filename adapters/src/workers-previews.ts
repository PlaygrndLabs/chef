import type { PreviewDeployment, PreviewHost } from "@kargah/core";

export interface WorkersBuildsConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly workerName: string;
  readonly pollMs?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface BuildSummary {
  readonly build_uuid: string;
  readonly status?: string;
  readonly build_outcome?: string | null;
  readonly preview_url?: string | null;
  readonly build_trigger_metadata?: { readonly commit_hash?: string; readonly branch?: string };
}

interface Envelope<T> {
  readonly success: boolean;
  readonly result: T;
  readonly errors?: readonly { message: string }[];
}

export class WorkersBuildsPreviewHost implements PreviewHost {
  private tag: string | null = null;

  constructor(private readonly config: WorkersBuildsConfig) {}

  async deploy(input: { repo: string; branch: string; commitId: string }): Promise<PreviewDeployment> {
    const deadline = Date.now() + (this.config.timeoutMs ?? 10 * 60 * 1000);
    const tag = await this.workerTag();
    while (Date.now() < deadline) {
      const builds = await this.api<BuildSummary[]>(`/builds/workers/${tag}/builds?per_page=25`);
      const build = builds.find((b) => b.build_trigger_metadata?.commit_hash === input.commitId);
      if (build && build.build_outcome && build.build_outcome !== "success") throw new Error(`preview build ${build.build_uuid} for ${input.commitId} ended with ${build.build_outcome}`);
      if (build && build.build_outcome === "success") {
        const detail = await this.api<BuildSummary>(`/builds/builds/${build.build_uuid}`);
        if (detail.preview_url) return { url: detail.preview_url, versionId: build.build_uuid, commitId: input.commitId };
      }
      await (this.config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(this.config.pollMs ?? 5000);
    }
    throw new Error(`no preview for ${input.branch}@${input.commitId} within the timeout`);
  }

  async current(input: { repo: string; branch: string }): Promise<PreviewDeployment | null> {
    const tag = await this.workerTag();
    const builds = await this.api<BuildSummary[]>(`/builds/workers/${tag}/builds?per_page=25`);
    const build = builds.find((b) => b.build_trigger_metadata?.branch === input.branch && b.build_outcome === "success");
    if (!build) return null;
    const detail = await this.api<BuildSummary>(`/builds/builds/${build.build_uuid}`);
    return detail.preview_url ? { url: detail.preview_url, versionId: build.build_uuid, commitId: build.build_trigger_metadata?.commit_hash ?? "" } : null;
  }

  private async workerTag(): Promise<string> {
    if (this.tag) return this.tag;
    const script = await this.api<{ id?: string; tag?: string }>(`/workers/scripts/${this.config.workerName}/settings`);
    this.tag = script.tag ?? script.id ?? this.config.workerName;
    return this.tag;
  }

  private async api<T>(path: string): Promise<T> {
    const response = await (this.config.fetch ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}${path}`, {
      headers: { authorization: `Bearer ${this.config.apiToken}`, accept: "application/json" },
    });
    const body = (await response.json()) as Envelope<T>;
    if (!response.ok || !body.success) throw new Error(`Cloudflare API ${path} failed: ${response.status} ${body.errors?.map((e) => e.message).join("; ") ?? ""}`);
    return body.result;
  }
}
