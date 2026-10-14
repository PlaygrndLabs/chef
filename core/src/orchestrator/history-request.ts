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

export const SESSION_HISTORY_ROUTE = /^\/api\/projects\/[a-z][a-z0-9-]{1,30}\/sessions\/([a-z0-9-]{1,40})\/history(?:\/([0-9a-f]{7,64}))?$/;

export async function sessionHistoryResponse(orchestrator: Orchestrator, sessionId: string, commitId: string | null): Promise<Response> {
  try {
    if (!commitId) return Response.json(await orchestrator.sessionHistory(sessionId));
    const changes = await orchestrator.sessionCommit(sessionId, commitId);
    return changes ? Response.json(changes) : Response.json({ error: `session ${sessionId} has no commit ${commitId}` }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("unknown session")) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
