import { describe, expect, it } from "vitest";
import { applyUpdate, describeSettings, NO_SETTINGS, resolveSettings } from "../../src/settings.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

describe("app settings", () => {
  it("prefers settings saved in the app over the deployment's secrets", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-deployment", OPENAI_API_KEY: "sk-openai-deployment", PLANNER_MODEL: "claude-opus-5-5", ATTEMPTS: "2" };
    expect(resolveSettings(NO_SETTINGS, env)).toMatchObject({ llm: { kind: "anthropic", apiKey: "sk-ant-deployment" }, voice: { kind: "openai", apiKey: "sk-openai-deployment" }, jev: null, cloudflare: null, attempts: 2 });
    const saved = applyUpdate(NO_SETTINGS, { llm: { kind: "custom", baseUrl: "https://llm.example/v1/", apiKey: "app-key-0001" }, models: { coder: "claude-haiku-5-5" }, attempts: 3 });
    if (!saved.ok) throw new Error(saved.error);
    const resolved = resolveSettings(saved.settings, env);
    expect(resolved.llm).toEqual({ kind: "custom", baseUrl: "https://llm.example/v1", apiKey: "app-key-0001" });
    expect(resolved.models).toEqual({ planner: "claude-opus-5-5", reviewer: "claude-opus-5-5", coder: "claude-haiku-5-5" });
    expect(resolved.attempts).toBe(3);
    expect(describeSettings(saved.settings, env)).toEqual({
      llm: { kind: "custom", baseUrl: "https://llm.example/v1", keyHint: "…0001", source: "app" },
      voice: { kind: "openai", baseUrl: null, keyHint: "…ment", source: "deployment" },
      jev: null,
      cloudflare: null,
      models: { planner: "claude-opus-5-5", reviewer: "claude-opus-5-5", coder: "claude-haiku-5-5", source: "app" },
      attempts: { value: 3, source: "app" },
    });
  });

  it("reads every service from the environment", () => {
    const resolved = resolveSettings(NO_SETTINGS, { LLM_BASE_URL: "https://llm.example", LLM_API_KEY: "k", VOICE_BASE_URL: "https://voice.example/v1", VOICE_API_KEY: "v", TYPESAFE_API_KEY: "ts", CF_ACCOUNT_ID: ACCOUNT, CF_API_TOKEN: "cf" });
    expect(resolved).toMatchObject({
      llm: { kind: "custom", baseUrl: "https://llm.example", apiKey: "k" },
      voice: { kind: "custom", baseUrl: "https://voice.example/v1", apiKey: "v" },
      jev: { apiKey: "ts" },
      cloudflare: { accountId: ACCOUNT, apiToken: "cf" },
    });
    expect(describeSettings(NO_SETTINGS, {})).toMatchObject({ llm: null, voice: null, jev: null, cloudflare: null, attempts: { value: 2, source: "deployment" } });
  });

  it("keeps the parts that are not updated, clears with null and rejects bad input", () => {
    const first = applyUpdate(NO_SETTINGS, { llm: { kind: "anthropic", apiKey: "sk-ant-1" }, voice: { kind: "openai", apiKey: "sk-o" }, jev: { apiKey: "ts-key" }, cloudflare: { accountId: ACCOUNT, apiToken: "cf-token" } });
    if (!first.ok) throw new Error(first.error);
    const second = applyUpdate(first.settings, { voice: null });
    expect(second).toEqual({ ok: true, settings: { ...first.settings, voice: null } });
    expect(applyUpdate({ llm: null, voice: null } as never, { attempts: 1 })).toEqual({ ok: true, settings: { ...NO_SETTINGS, attempts: 1 } });
    for (const bad of [{ llm: { kind: "custom", apiKey: "k" } }, { llm: { kind: "custom", baseUrl: "ftp://x", apiKey: "k" } }, { llm: { kind: "anthropic", apiKey: " " } }, { cloudflare: { accountId: "abc", apiToken: "t" } }, { models: { coder: "bad model" } }, { attempts: 9 }, { unknown: 1 }, null]) {
      expect(applyUpdate(NO_SETTINGS, bad).ok).toBe(false);
    }
  });
});
