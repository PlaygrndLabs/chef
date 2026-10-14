import type { Orchestrator } from "./orchestrator.ts";

export const HISTORY_ROUTE = /^\/api\/projects\/[a-z][a-z0-9-]{1,30}\/history(?:\/([0-9a-f]{7,64}))?$/;

const MAX_HISTORY = 500;

export async function historyResponse(orchestrator: Orchestrator, commitId: string | null, limit: string | null): Promise<Response> {
  if (commitId) {
    const changes = await orchestrator.commitChanges(commitId);
    return changes ? Response.json(changes) : Response.json({ error: `main has no commit ${commitId}` }, { status: 404 });
  }
  const wanted = Number(limit ?? 50);
  return Response.json(await orchestrator.history(Number.isInteger(wanted) && wanted > 0 ? Math.min(wanted, MAX_HISTORY) : 50));
}
