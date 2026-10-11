import type { PreviewDeployment, PreviewHost } from "../ports/preview-host.ts";
import { slugify } from "../util/hash.ts";

export class MemoryPreviewHost implements PreviewHost {
  readonly deployments: (PreviewDeployment & { branch: string; repo: string })[] = [];

  async deploy(input: { repo: string; branch: string; commitId: string }): Promise<PreviewDeployment> {
    const alias = slugify(input.branch.replace(/^preview\//, ""), 30);
    const deployment = { url: `https://${alias}-${slugify(input.repo, 20)}.preview.example`, versionId: `v${this.deployments.length + 1}`, commitId: input.commitId };
    this.deployments.push({ ...deployment, branch: input.branch, repo: input.repo });
    return deployment;
  }

  async current(input: { repo: string; branch: string }): Promise<PreviewDeployment | null> {
    return this.deployments.filter((d) => d.repo === input.repo && d.branch === input.branch).at(-1) ?? null;
  }
}
