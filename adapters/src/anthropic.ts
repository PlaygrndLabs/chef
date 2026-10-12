import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const DEFAULT_MODEL = "claude-opus-5-5";

export type MessagesClient = Pick<Anthropic, "messages" | "beta">;

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export type LlmProvider = { readonly kind: "anthropic"; readonly apiKey: string } | { readonly kind: "custom"; readonly baseUrl: string; readonly apiKey: string };

export interface LlmEndpoint {
  readonly client: MessagesClient;
  readonly via: LlmProvider["kind"];
  readonly serverFallbacks: boolean;
}

export interface LlmEnv {
  readonly LLM_BASE_URL?: string | undefined;
  readonly LLM_API_KEY?: string | undefined;
  readonly ANTHROPIC_API_KEY?: string | undefined;
}

export function providerFromEnv(env: LlmEnv): LlmProvider | null {
  if (env.LLM_BASE_URL) {
    if (!env.LLM_API_KEY) throw new Error("LLM_BASE_URL is set but LLM_API_KEY is missing");
    return { kind: "custom", baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY };
  }
  return env.ANTHROPIC_API_KEY ? { kind: "anthropic", apiKey: env.ANTHROPIC_API_KEY } : null;
}

export function providerBaseUrl(provider: LlmProvider): string {
  return provider.kind === "custom" ? provider.baseUrl.replace(/\/+$/, "") : ANTHROPIC_BASE_URL;
}

export function llmFromProvider(provider: LlmProvider, fetchImpl?: typeof fetch): LlmEndpoint {
  const options = fetchImpl ? { fetch: fetchImpl } : {};
  if (provider.kind === "custom") return { client: new Anthropic({ ...options, baseURL: providerBaseUrl(provider), apiKey: provider.apiKey }), via: "custom", serverFallbacks: false };
  return { client: new Anthropic({ ...options, apiKey: provider.apiKey }), via: "anthropic", serverFallbacks: true };
}

export function llmFromEnv(env: LlmEnv, fetchImpl?: typeof fetch): LlmEndpoint {
  const provider = providerFromEnv(env);
  if (!provider) throw new Error("set ANTHROPIC_API_KEY, or LLM_BASE_URL and LLM_API_KEY for a custom provider");
  return llmFromProvider(provider, fetchImpl);
}

export class RefusedError extends Error {}

export interface StructuredInput<S extends z.ZodType> {
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly schema: S;
  readonly effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

interface ParsedLike {
  readonly stop_reason: string | null;
  readonly stop_details?: { readonly explanation?: string | null } | null;
  readonly parsed_output?: unknown;
}

function unwrap<S extends z.ZodType>(response: ParsedLike): z.infer<S> {
  if (response.stop_reason === "refusal") throw new RefusedError(`model declined: ${response.stop_details?.explanation ?? "no explanation"}`);
  if (response.parsed_output === null || response.parsed_output === undefined) throw new Error(`model returned no parsable output (stop_reason ${response.stop_reason})`);
  return response.parsed_output as z.infer<S>;
}

export async function structured<S extends z.ZodType>(endpoint: LlmEndpoint, input: StructuredInput<S>): Promise<z.infer<S>> {
  const common = { model: input.model, max_tokens: 16000, system: input.system, messages: [{ role: "user" as const, content: input.prompt }] };
  if (endpoint.serverFallbacks) {
    const response = await endpoint.client.beta.messages.parse({
      ...common,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: input.effort ?? "high", format: betaZodOutputFormat(input.schema) },
    });
    return unwrap<S>(response as ParsedLike);
  }
  const response = await endpoint.client.messages.parse({ ...common, output_config: { effort: input.effort ?? "high", format: zodOutputFormat(input.schema) } });
  return unwrap<S>(response as ParsedLike);
}
