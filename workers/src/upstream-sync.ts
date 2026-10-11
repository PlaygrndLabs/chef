import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export interface PushedPayload {
  readonly type?: string;
  readonly source?: { readonly repoName?: string; readonly repo_name?: string };
  readonly payload?: { readonly ref?: string; readonly before?: string | null; readonly after?: string };
}

export function canonicalPush(event: PushedPayload): { project: string; ref: string; before: string | null; after: string } | null {
  const repo = event.source?.repoName ?? event.source?.repo_name;
  const ref = event.payload?.ref;
  const after = event.payload?.after;
  if (!repo || !ref || !after) return null;
  if (repo.includes("--")) return null;
  if (ref !== "refs/heads/main") return null;
  return { project: repo, ref: "main", before: event.payload?.before ?? null, after };
}

export class UpstreamSync extends WorkflowEntrypoint<Env, PushedPayload> {
  override async run(event: WorkflowEvent<PushedPayload>, step: WorkflowStep): Promise<void> {
    const push = canonicalPush(event.payload);
    if (!push) return;
    await step.do("notify project", { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" } }, async () => {
      const stub = this.env.PROJECT.get(this.env.PROJECT.idFromName(push.project)) as unknown as { onMainPushed(event: { repo: string; ref: string; before: string | null; after: string }): Promise<void> };
      await stub.onMainPushed({ repo: push.project, ref: push.ref, before: push.before, after: push.after });
    });
  }
}
