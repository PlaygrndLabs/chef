import { FeatureArrangement } from "../spec/layout.ts";
import { ControlError, type Orchestrator } from "./orchestrator.ts";

export const FEATURE_ROUTE = /^\/api\/projects\/[a-z][a-z0-9-]{1,30}\/features\/([a-z][a-z0-9-]{0,39})$/;

export async function featureRequest(request: Request, orchestrator: Orchestrator, featureId: string): Promise<{ readonly response: Response; readonly mainChanged: boolean }> {
  try {
    if (request.method === "PATCH") {
      const parsed = FeatureArrangement.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return { response: Response.json({ error: parsed.error.issues[0]?.message ?? "send a title or a parent" }, { status: 400 }), mainChanged: false };
      return { response: Response.json({ layout: await orchestrator.arrange(featureId, parsed.data) }), mainChanged: false };
    }
    if (request.method === "DELETE") {
      const result = await orchestrator.removeFeature(featureId);
      if (result.reverted) return { response: Response.json({ ...result, error: "Taking this feature out broke the app's checks, so chef kept it." }, { status: 409 }), mainChanged: true };
      return { response: Response.json(result), mainChanged: result.commitId !== null };
    }
  } catch (error) {
    if (error instanceof ControlError) return { response: Response.json({ error: error.message }, { status: 409 }), mainChanged: false };
    throw error;
  }
  return { response: Response.json({ error: "method not allowed" }, { status: 405 }), mainChanged: false };
}
