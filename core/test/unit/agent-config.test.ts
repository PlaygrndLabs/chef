import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/fakes/runtime.ts";
import { AgentSettings, agentsView, applyAgentConfig, EMPTY_AGENT_CONFIG, parseAgentConfig, routerConfigOf, DEFAULT_ROUTER_SETTINGS, type AgentConfig } from "../../src/profiles/agent-config.ts";
import { customAgent, parseProfile, withSkills } from "../../src/profiles/profile.ts";

const backend = parseProfile(`---
role: backend
label: Backend builder
model: coder-default
description: Implements server code.
plannable: true
writeScope:
  - features/{feature}/**
---
Implement {feature}.`);

const planner = parseProfile(`---
role: planner
label: Planner
model: planner-default
description: Plans.
runs: api
writeScope: []
---
Plan it.`);

const defaults = { backend, planner };
const models = { planner: "opus", reviewer: "opus", coder: "sonnet" };
const skill = { name: "tidy-sql", description: "Use when writing SQL", body: "Keep queries short." };

const config: AgentConfig = {
  roles: {
    backend: { label: "Server builder", description: "Builds servers.", instructions: "Build {feature} carefully.", model: "claude-opus-5-5", skills: ["tidy-sql"] },
    "data-modeler": { label: "Data modeler", description: "Designs tables.", instructions: "Model the data for {feature}.", model: null, skills: [] },
  },
  skills: [skill],
  router: null,
};

describe("agent settings", () => {
  it("applies edits, skills and new roles on top of the file defaults", () => {
    const profiles = applyAgentConfig(defaults, config);
    expect(profiles["backend"]).toMatchObject({ label: "Server builder", model: "claude-opus-5-5", instructions: "Build {feature} carefully.", writeScope: ["features/{feature}/**"], skills: [skill] });
    expect(profiles["data-modeler"]).toMatchObject({ runs: "agent", plannable: true, model: "coder-default", sharedAccess: true });
    expect(profiles["planner"]).toBe(planner);
    const agent = customAgent(profiles["backend"] as NonNullable<(typeof profiles)["backend"]>, "todo-add", ["features/todo-add/**"]);
    expect(agent.skills).toEqual([skill]);
    expect(agent.prompt).toContain("Build todo-add carefully.");
    expect(withSkills("Plan it.", [skill])).toBe("Plan it.\n\n## Skill: tidy-sql\nUse when: Use when writing SQL\n\nKeep queries short.");
  });

  it("rejects unknown skills, reserved names and bad models", () => {
    expect(parseAgentConfig(config, defaults)).toEqual({ ok: true, config });
    const missing = parseAgentConfig({ ...config, skills: [] }, defaults);
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining("tidy-sql") });
    const reserved = parseAgentConfig({ ...config, roles: { sync: config.roles["data-modeler"] } }, defaults);
    expect(reserved).toMatchObject({ ok: false, error: expect.stringContaining("sync") });
    const model = parseAgentConfig({ ...config, roles: { backend: { ...config.roles["backend"], model: "bad model" } } }, defaults);
    expect(model).toMatchObject({ ok: false, error: expect.stringContaining("model id") });
  });

  it("keeps every saved version so a bad prompt can be undone", async () => {
    let now = 1000;
    const settings = new AgentSettings(new MemoryStore(), () => now++);
    expect((await settings.current()).version).toBe(0);
    const first = await settings.save(config, "Taught the backend SQL", 0);
    expect(first).toMatchObject({ ok: true, stored: { version: 1, summary: "Taught the backend SQL" } });
    expect(await settings.save(EMPTY_AGENT_CONFIG, "stale", 0)).toMatchObject({ ok: false, status: 409 });
    await settings.save({ ...config, roles: {} }, "Reset roles", 1);
    expect((await settings.history()).map((v) => v.version)).toEqual([2, 1]);
    const restored = await settings.restore(1);
    expect(restored).toMatchObject({ ok: true, stored: { version: 3, summary: "Restored version 1", config } });
    expect(await settings.restore(0)).toMatchObject({ ok: true, stored: { version: 4, config: EMPTY_AGENT_CONFIG } });
    expect(await settings.restore(99)).toMatchObject({ ok: false, status: 404 });
    for (let i = 0; i < 40; i++) await settings.save(config, `edit ${i}`, null);
    expect(await settings.history()).toHaveLength(30);
  });

  it("describes roles with their defaults and resolved models", async () => {
    const view = agentsView(defaults, { version: 1, at: 1, summary: "s", config }, [], models, false);
    expect(view.roles.map((r) => r.role)).toEqual(["planner", "backend", "data-modeler"]);
    expect(view.roles[0]).toMatchObject({ label: "Planner", defaultModel: "opus", edited: false, custom: false, runs: "api" });
    expect(view.roles[1]).toMatchObject({ label: "Server builder", model: "claude-opus-5-5", defaultModel: "sonnet", edited: true, skills: ["tidy-sql"], defaults: { label: "Backend builder", instructions: "Implement {feature}." } });
    expect(view.roles[2]).toMatchObject({ custom: true, defaults: null });
    expect(view.router).toEqual(DEFAULT_ROUTER_SETTINGS);
  });

  it("turns router settings into the router's config", () => {
    const router = routerConfigOf({ ...DEFAULT_ROUTER_SETTINGS, useJev: false, thresholds: { new_feature: 0.7, change_feature: 0.8, question: 0.5, feature: 0.9 } });
    expect(router).toMatchObject({ useClassifier: false, featureThreshold: 0.9, thresholds: { new_feature: 0.7, change_feature: 0.8, question: 0.5 } });
  });
});
