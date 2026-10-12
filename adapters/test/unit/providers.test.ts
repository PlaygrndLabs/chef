import { describe, expect, it } from "vitest";
import { applyUpdate, describeSettings, effectiveSettings, NO_SETTINGS } from "../../src/providers.ts";

describe("provider settings", () => {
  it("prefers settings saved in the app over the deployment's secrets", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-deployment", OPENAI_API_KEY: "sk-openai-deployment" };
    expect(effectiveSettings(NO_SETTINGS, env)).toEqual({ llm: { kind: "anthropic", apiKey: "sk-ant-deployment" }, voice: { kind: "openai", apiKey: "sk-openai-deployment" } });
    const saved = applyUpdate(NO_SETTINGS, { llm: { kind: "custom", baseUrl: "https://llm.example/v1/", apiKey: "app-key-0001" } });
    if (!saved.ok) throw new Error(saved.error);
    expect(effectiveSettings(saved.settings, env).llm).toEqual({ kind: "custom", baseUrl: "https://llm.example/v1", apiKey: "app-key-0001" });
    expect(describeSettings(saved.settings, env)).toEqual({
      llm: { kind: "custom", baseUrl: "https://llm.example/v1", keyHint: "…0001", source: "app" },
      voice: { kind: "openai", baseUrl: null, keyHint: "…ment", source: "deployment" },
    });
  });

  it("reads a custom provider and a custom voice provider from the environment", () => {
    expect(effectiveSettings(NO_SETTINGS, { LLM_BASE_URL: "https://llm.example", LLM_API_KEY: "k", VOICE_BASE_URL: "https://voice.example/v1", VOICE_API_KEY: "v" })).toEqual({
      llm: { kind: "custom", baseUrl: "https://llm.example", apiKey: "k" },
      voice: { kind: "custom", baseUrl: "https://voice.example/v1", apiKey: "v" },
    });
    expect(describeSettings(NO_SETTINGS, {})).toEqual({ llm: null, voice: null });
  });

  it("keeps the part that is not updated, clears with null and rejects bad input", () => {
    const first = applyUpdate(NO_SETTINGS, { llm: { kind: "anthropic", apiKey: "sk-ant-1" }, voice: { kind: "openai", apiKey: "sk-o" } });
    if (!first.ok) throw new Error(first.error);
    const second = applyUpdate(first.settings, { voice: null });
    expect(second).toEqual({ ok: true, settings: { llm: { kind: "anthropic", apiKey: "sk-ant-1" }, voice: null } });
    expect(applyUpdate(NO_SETTINGS, { llm: { kind: "custom", apiKey: "k" } }).ok).toBe(false);
    expect(applyUpdate(NO_SETTINGS, { llm: { kind: "custom", baseUrl: "ftp://x", apiKey: "k" } }).ok).toBe(false);
    expect(applyUpdate(NO_SETTINGS, { llm: { kind: "anthropic", apiKey: " " } }).ok).toBe(false);
    expect(applyUpdate(NO_SETTINGS, null).ok).toBe(false);
  });
});
