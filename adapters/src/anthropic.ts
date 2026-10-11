import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const DEFAULT_MODEL = "claude-opus-5-5";

export type MessagesClient = Pick<Anthropic, "beta">;

export function anthropicFromEnv(apiKey?: string): Anthropic {
  return new Anthropic(apiKey ? { apiKey } : {});
}

export class RefusedError extends Error {}

export async function structured<S extends z.ZodType>(client: MessagesClient, input: { model: string; system: string; prompt: string; schema: S; effort?: "low" | "medium" | "high" | "xhigh" | "max" }): Promise<z.infer<S>> {
  const response = await client.beta.messages.parse({
    model: input.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: input.system,
    output_config: { effort: input.effort ?? "high", format: betaZodOutputFormat(input.schema) },
    messages: [{ role: "user", content: input.prompt }],
  });
  if (response.stop_reason === "refusal") throw new RefusedError(`model declined: ${response.stop_details?.explanation ?? "no explanation"}`);
  if (response.parsed_output === null || response.parsed_output === undefined) throw new Error(`model returned no parsable output (stop_reason ${response.stop_reason})`);
  return response.parsed_output as z.infer<S>;
}
