import { MapEdit } from "../features/edit.ts";
import { ControlError, type Orchestrator } from "./orchestrator.ts";

export const FEATURE_MAP_ROUTE = /^\/api\/projects\/[a-z][a-z0-9-]{1,30}\/feature-map(\/map)?$/;

export async function featureMapRequest(request: Request, orchestrator: Orchestrator, explore: boolean): Promise<{ readonly response: Response; readonly mainChanged: boolean }> {
  try {
    if (request.method === "GET" && !explore) return { response: Response.json(await orchestrator.featureMap()), mainChanged: false };
    if (request.method === "POST" && explore) {
      const result = await orchestrator.mapFeatures();
      return { response: Response.json(result), mainChanged: result.commitId !== null };
    }
    if (request.method === "POST") {
      const parsed = MapEdit.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return { response: Response.json({ error: parsed.error.issues[0]?.message ?? "send a change to the feature list" }, { status: 400 }), mainChanged: false };
      const result = await orchestrator.editFeatureMap(parsed.data);
      return { response: Response.json(result), mainChanged: true };
    }
  } catch (error) {
    if (error instanceof ControlError) return { response: Response.json({ error: error.message }, { status: 409 }), mainChanged: false };
    throw error;
  }
  return { response: Response.json({ error: "method not allowed" }, { status: 405 }), mainChanged: false };
}
