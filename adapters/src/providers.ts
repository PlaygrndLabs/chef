import { z } from "zod";
import { providerFromEnv, type LlmEnv, type LlmProvider } from "./anthropic.ts";

export type VoiceProvider = { readonly kind: "openai"; readonly apiKey: string } | { readonly kind: "custom"; readonly baseUrl: string; readonly apiKey: string };

export interface ProviderSettings {
  readonly llm: LlmProvider | null;
  readonly voice: VoiceProvider | null;
}

export interface ProviderEnv extends LlmEnv {
  readonly OPENAI_API_KEY?: string | undefined;
  readonly VOICE_BASE_URL?: string | undefined;
  readonly VOICE_API_KEY?: string | undefined;
}

export const NO_SETTINGS: ProviderSettings = { llm: null, voice: null };

export const NO_LLM = "chef has no model provider yet: add an Anthropic API key or a custom provider in Settings";

export function voiceFromEnv(env: ProviderEnv): VoiceProvider | null {
  if (env.OPENAI_API_KEY) return { kind: "openai", apiKey: env.OPENAI_API_KEY };
  if (env.VOICE_BASE_URL && env.VOICE_API_KEY) return { kind: "custom", baseUrl: env.VOICE_BASE_URL, apiKey: env.VOICE_API_KEY };
  return null;
}

export function effectiveSettings(saved: ProviderSettings, env: ProviderEnv): ProviderSettings {
  return { llm: saved.llm ?? providerFromEnv(env), voice: saved.voice ?? voiceFromEnv(env) };
}

const key = z.string().trim().min(1, "the API key is required").max(4096);
const baseUrl = z
  .string()
  .trim()
  .url("the base URL must be a full URL")
  .refine((value) => /^https?:\/\//.test(value), "the base URL must start with https:// or http://")
  .transform((value) => value.replace(/\/+$/, ""));

const LlmInput = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("anthropic"), apiKey: key }), z.strictObject({ kind: z.literal("custom"), baseUrl, apiKey: key })]);
const VoiceInput = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("openai"), apiKey: key }), z.strictObject({ kind: z.literal("custom"), baseUrl, apiKey: key })]);

export const SettingsUpdate = z.strictObject({ llm: LlmInput.nullable().optional(), voice: VoiceInput.nullable().optional() });

export function applyUpdate(saved: ProviderSettings, body: unknown): { ok: true; settings: ProviderSettings } | { ok: false; error: string } {
  const parsed = SettingsUpdate.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  const { llm, voice } = parsed.data;
  return { ok: true, settings: { llm: llm === undefined ? saved.llm : llm, voice: voice === undefined ? saved.voice : voice } };
}

export interface ProviderView {
  readonly kind: string;
  readonly baseUrl: string | null;
  readonly keyHint: string;
  readonly source: "app" | "deployment";
}

export interface SettingsView {
  readonly llm: ProviderView | null;
  readonly voice: ProviderView | null;
}

function hint(apiKey: string): string {
  return apiKey.length > 8 ? `…${apiKey.slice(-4)}` : "set";
}

function view(saved: LlmProvider | VoiceProvider | null, fallback: LlmProvider | VoiceProvider | null): ProviderView | null {
  const provider = saved ?? fallback;
  if (!provider) return null;
  return { kind: provider.kind, baseUrl: provider.kind === "custom" ? provider.baseUrl : null, keyHint: hint(provider.apiKey), source: saved ? "app" : "deployment" };
}

export function describeSettings(saved: ProviderSettings, env: ProviderEnv): SettingsView {
  return { llm: view(saved.llm, providerFromEnv(env)), voice: view(saved.voice, voiceFromEnv(env)) };
}
