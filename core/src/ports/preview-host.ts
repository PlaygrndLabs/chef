export interface PreviewDeployment {
  readonly url: string;
  readonly versionId: string;
  readonly commitId: string;
  readonly gated?: boolean;
}

export interface PreviewHost {
  deploy(input: { repo: string; branch: string; commitId: string }): Promise<PreviewDeployment>;
  current(input: { repo: string; branch: string }): Promise<PreviewDeployment | null>;
}
