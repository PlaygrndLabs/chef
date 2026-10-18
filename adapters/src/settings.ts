import { z } from "zod";
import { providerFromEnv, type LlmEnv, type LlmProvider } from "./anthropic.ts";
import { LIVE_MODEL } from "./gpt-live.ts";
import { REALTIME_MODEL } from "./realtime.ts";

export type VoiceProvider = { readonly kind: "openai"; readonly apiKey: string; readonly baseUrl?: string } | { readonly kind: "custom"; readonly baseUrl: string; readonly apiKey: string };

export interface JevSettings {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export interface Managed {
  readonly by: string;
  readonly llm: LlmProvider | null;
  readonly voice: VoiceProvider | null;
  readonly jev: JevSettings | null;
}

export interface CloudflareSettings {
  readonly accountId: string;
  readonly apiToken: string;
}

export interface ModelSettings {
  readonly planner: string;
  readonly reviewer: string;
  readonly coder: string;
  readonly voice: string;
}

export interface AppSettings {
  readonly llm: LlmProvider | null;
  readonly voice: VoiceProvider | null;
  readonly jev: JevSettings | null;
  readonly cloudflare: CloudflareSettings | null;
  readonly models: Partial<ModelSettings> | null;
  readonly attempts: number | null;
}

export interface Resolved {
  readonly llm: LlmProvider | null;
  readonly voice: VoiceProvider | null;
  readonly jev: JevSettings | null;
  readonly cloudflare: CloudflareSettings | null;
  readonly models: ModelSettings;
  readonly attempts: number;
}

export interface SettingsEnv extends LlmEnv {
  readonly OPENAI_API_KEY?: string | undefined;
  readonly VOICE_BASE_URL?: string | undefined;
  readonly VOICE_API_KEY?: string | undefined;
  readonly TYPESAFE_API_KEY?: string | undefined;
  readonly TYPESAFE_BASE_URL?: string | undefined;
  readonly CF_ACCOUNT_ID?: string | undefined;
  readonly CF_API_TOKEN?: string | undefined;
  readonly PLANNER_MODEL?: string | undefined;
  readonly REVIEWER_MODEL?: string | undefined;
  readonly CODER_MODEL?: string | undefined;
  readonly VOICE_MODEL?: string | undefined;
  readonly REALTIME_MODEL?: string | undefined;
  readonly ATTEMPTS?: string | undefined;
}

export const NO_SETTINGS: AppSettings = { llm: null, voice: null, jev: null, cloudflare: null, models: null, attempts: null };

export const DEFAULT_MODELS: Omit<ModelSettings, "voice"> = { planner: "claude-opus-5-5", reviewer: "claude-opus-5-5", coder: "claude-sonnet-5-5" };

export const MAX_ATTEMPTS = 4;

export const NO_LLM = "Chef has no model provider yet: add an Anthropic API key or a custom provider in Settings";

export const NO_CLOUDFLARE = "Chef needs a Cloudflare account id and API token in Settings to give running apps their addresses";

export function voiceFromEnv(env: SettingsEnv): VoiceProvider | null {
  if (env.OPENAI_API_KEY) return { kind: "openai", apiKey: env.OPENAI_API_KEY };
  if (env.VOICE_BASE_URL && env.VOICE_API_KEY) return { kind: "custom", baseUrl: env.VOICE_BASE_URL, apiKey: env.VOICE_API_KEY };
  return null;
}

function defaultVoiceModel(voice: VoiceProvider | null, env: SettingsEnv): string {
  return voice?.kind === "openai" ? (env.VOICE_MODEL ?? LIVE_MODEL) : (env.REALTIME_MODEL ?? REALTIME_MODEL);
}

function jevFromEnv(env: SettingsEnv): JevSettings | null {
  if (!env.TYPESAFE_API_KEY) return null;
  return env.TYPESAFE_BASE_URL ? { apiKey: env.TYPESAFE_API_KEY, baseUrl: env.TYPESAFE_BASE_URL } : { apiKey: env.TYPESAFE_API_KEY };
}

function cloudflareFromEnv(env: SettingsEnv): CloudflareSettings | null {
  return env.CF_ACCOUNT_ID && env.CF_API_TOKEN ? { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN } : null;
}

function attemptsFromEnv(env: SettingsEnv): number {
  const value = Number(env.ATTEMPTS);
  return Number.isInteger(value) && value >= 1 && value <= MAX_ATTEMPTS ? value : 1;
}

export function resolveSettings(saved: AppSettings, env: SettingsEnv, managed: Managed | null = null): Resolved {
  const voice = managed ? managed.voice : (saved.voice ?? voiceFromEnv(env));
  return {
    llm: managed ? managed.llm : (saved.llm ?? providerFromEnv(env)),
    voice,
    jev: managed ? managed.jev : (saved.jev ?? jevFromEnv(env)),
    cloudflare: saved.cloudflare ?? cloudflareFromEnv(env),
    models: {
      planner: saved.models?.planner ?? env.PLANNER_MODEL ?? DEFAULT_MODELS.planner,
      reviewer: saved.models?.reviewer ?? env.REVIEWER_MODEL ?? DEFAULT_MODELS.reviewer,
      coder: saved.models?.coder ?? env.CODER_MODEL ?? DEFAULT_MODELS.coder,
      voice: saved.models?.voice ?? defaultVoiceModel(voice, env),
    },
    attempts: saved.attempts ?? attemptsFromEnv(env),
  };
}

const secret = z.string().trim().min(1, "the key is required").max(4096);
const baseUrl = z
  .string()
  .trim()
  .url("the base URL must be a full URL")
  .refine((value) => /^https?:\/\//.test(value), "the base URL must start with https:// or http://")
  .transform((value) => value.replace(/\/+$/, ""));
const model = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/, "a model id uses letters, digits and . _ : / @ -");

const LlmInput = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("anthropic"), apiKey: secret }), z.strictObject({ kind: z.literal("custom"), baseUrl, apiKey: secret })]);
const VoiceInput = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("openai"), apiKey: secret }), z.strictObject({ kind: z.literal("custom"), baseUrl, apiKey: secret })]);
const JevInput = z.strictObject({ apiKey: secret });
const CloudflareInput = z.strictObject({ accountId: z.string().trim().regex(/^[0-9a-f]{32}$/, "the account id is 32 hexadecimal characters"), apiToken: secret });
const ManagedInput = z.strictObject({
  by: z.string().trim().min(1, "say who manages the providers").max(60),
  llm: LlmInput.nullable(),
  voice: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("openai"), apiKey: secret, baseUrl: baseUrl.optional() }), z.strictObject({ kind: z.literal("custom"), baseUrl, apiKey: secret })]).nullable(),
  jev: z.strictObject({ apiKey: secret, baseUrl: baseUrl.optional() }).nullable(),
});

export function readManaged(body: unknown): { ok: true; managed: Managed } | { ok: false; error: string } {
  const parsed = ManagedInput.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  const { by, llm, voice, jev } = parsed.data;
  const managedVoice: VoiceProvider | null = !voice ? null : voice.kind === "custom" ? voice : voice.baseUrl ? { kind: "openai", apiKey: voice.apiKey, baseUrl: voice.baseUrl } : { kind: "openai", apiKey: voice.apiKey };
  const managedJev: JevSettings | null = !jev ? null : jev.baseUrl ? { apiKey: jev.apiKey, baseUrl: jev.baseUrl } : { apiKey: jev.apiKey };
  return { ok: true, managed: { by, llm, voice: managedVoice, jev: managedJev } };
}

export const MANAGED_PARTS = ["llm", "voice", "jev"] as const;

const ModelsInput = z.strictObject({ planner: model.optional(), reviewer: model.optional(), coder: model.optional(), voice: model.optional() }).transform((models): Partial<ModelSettings> => Object.fromEntries(Object.entries(models).filter(([, value]) => value !== undefined)));

export const SettingsUpdate = z.strictObject({
  llm: LlmInput.nullable().optional(),
  voice: VoiceInput.nullable().optional(),
  jev: JevInput.nullable().optional(),
  cloudflare: CloudflareInput.nullable().optional(),
  models: ModelsInput.nullable().optional(),
  attempts: z.number().int().min(1).max(MAX_ATTEMPTS).nullable().optional(),
});

export function applyUpdate(saved: AppSettings, body: unknown): { ok: true; settings: AppSettings } | { ok: false; error: string } {
  const parsed = SettingsUpdate.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  const next = { ...NO_SETTINGS, ...saved };
  const update = parsed.data;
  return {
    ok: true,
    settings: {
      llm: update.llm === undefined ? next.llm : update.llm,
      voice: update.voice === undefined ? next.voice : update.voice,
      jev: update.jev === undefined ? next.jev : update.jev,
      cloudflare: update.cloudflare === undefined ? next.cloudflare : update.cloudflare,
      models: update.models === undefined ? next.models : update.models,
      attempts: update.attempts === undefined ? next.attempts : update.attempts,
    },
  };
}

export type Source = "app" | "deployment" | "managed";

export interface ProviderView {
  readonly kind: string;
  readonly baseUrl: string | null;
  readonly keyHint: string;
  readonly source: Source;
}

export interface SettingsView {
  readonly managed: { readonly by: string } | null;
  readonly llm: ProviderView | null;
  readonly voice: ProviderView | null;
  readonly jev: { readonly keyHint: string; readonly source: Source } | null;
  readonly cloudflare: { readonly accountId: string; readonly keyHint: string; readonly source: Source } | null;
  readonly models: ModelSettings & { readonly source: Source };
  readonly attempts: { readonly value: number; readonly source: Source };
}

export function keyHint(key: string): string {
  return key.length > 8 ? `…${key.slice(-4)}` : "set";
}

function view(saved: LlmProvider | VoiceProvider | null, fallback: LlmProvider | VoiceProvider | null): ProviderView | null {
  const provider = saved ?? fallback;
  if (!provider) return null;
  return { kind: provider.kind, baseUrl: provider.kind === "custom" ? provider.baseUrl : null, keyHint: keyHint(provider.apiKey), source: saved ? "app" : "deployment" };
}

function managedView(provider: LlmProvider | VoiceProvider | null): ProviderView | null {
  return provider ? { kind: provider.kind, baseUrl: null, keyHint: "managed", source: "managed" } : null;
}

export function describeSettings(stored: AppSettings, env: SettingsEnv, managed: Managed | null = null): SettingsView {
  const saved = { ...NO_SETTINGS, ...stored };
  const resolved = resolveSettings(saved, env, managed);
  const source = (value: unknown): Source => (value ? "app" : "deployment");
  return {
    managed: managed ? { by: managed.by } : null,
    llm: managed ? managedView(managed.llm) : view(saved.llm, providerFromEnv(env)),
    voice: managed ? managedView(managed.voice) : view(saved.voice, voiceFromEnv(env)),
    jev: resolved.jev ? { keyHint: managed ? "managed" : keyHint(resolved.jev.apiKey), source: managed ? "managed" : source(saved.jev) } : null,
    cloudflare: resolved.cloudflare ? { accountId: resolved.cloudflare.accountId, keyHint: keyHint(resolved.cloudflare.apiToken), source: source(saved.cloudflare) } : null,
    models: { ...resolved.models, source: source(saved.models && Object.keys(saved.models).length > 0) },
    attempts: { value: resolved.attempts, source: source(saved.attempts) },
  };
}
