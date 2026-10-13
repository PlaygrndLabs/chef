import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/fakes/runtime.ts";
import { AgentSettings, agentsView, applyAgentConfig, EMPTY_AGENT_CONFIG, mergeAgentConfig, parseAgentConfig, parseProjectAgentConfig, projectAgentsView, routerConfigOf, DEFAULT_ROUTER_SETTINGS, type AgentConfig, type RoleSetting, type RouterSettings } from "../../src/profiles/agent-config.ts";
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
const skill = { name: "tidy-sql", description: "Use when writing SQL", body: "Keep queries short.", everyone: false };
const house = { name: "house-style", description: "Use for any code", body: "Small functions.", everyone: true };

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

  it("gives skills meant for every role to every model-driven role, before its own", () => {
    const gardener = parseProfile(`---\nrole: gardener\nmodel: planner-default\ndescription: Keeps the map.\nruns: rules\nwriteScope: []\n---\nGarden.`);
    const profiles = applyAgentConfig({ ...defaults, gardener }, { ...config, skills: [skill, house] });
    expect(profiles["backend"]?.skills.map((s) => s.name)).toEqual(["house-style", "tidy-sql"]);
    expect(profiles["planner"]?.skills.map((s) => s.name)).toEqual(["house-style"]);
    expect(profiles["data-modeler"]?.skills.map((s) => s.name)).toEqual(["house-style"]);
    expect(profiles["gardener"]?.skills).toEqual([]);
    const view = agentsView(defaults, { version: 1, at: 1, summary: "s", config: { ...config, skills: [skill, house], roles: { ...config.roles, backend: { ...(config.roles["backend"] as RoleSetting), skills: ["tidy-sql", "house-style"] } } } }, [], models, false);
    expect(view.roles.find((r) => r.role === "backend")?.skills).toEqual(["tidy-sql"]);
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
    const saved = { ...DEFAULT_ROUTER_SETTINGS, useJev: false, thresholds: { new_feature: 0.7, change_feature: 0.8, question: 0.5, feature: 0.9 } } as unknown as RouterSettings;
    const router = routerConfigOf(saved);
    expect(router).toMatchObject({ useClassifier: false, featureThreshold: 0.9, thresholds: { new_feature: 0.7, change_feature: 0.8, chore: 0.85, question: 0.5 } });
    expect(router.wording?.intent.criteria.chore).toContain("maintenance");
  });

  it("lets a project override roles, add skills and set its own router on top of the shared settings", () => {
    const role = (instructions: string, skills: string[] = []): RoleSetting => ({ label: "Backend builder", description: "Implements server code.", instructions, model: null, skills });
    const shared: AgentConfig = { roles: { backend: role("Shared prompt.", ["tidy-sql"]) }, skills: [skill, house], router: null };
    const own: AgentConfig = { roles: { planner: { label: "Planner", description: "Plans.", instructions: "Plan for shop.", model: null, skills: ["shop-api"] } }, skills: [{ ...house, body: "Shop style." }, { name: "shop-api", description: "Use for the shop API", body: "Call /v2.", everyone: false }], router: { ...DEFAULT_ROUTER_SETTINGS, useJev: false } };
    const merged = mergeAgentConfig(shared, own);
    expect(Object.keys(merged.roles).sort()).toEqual(["backend", "planner"]);
    expect(merged.skills.map((s) => [s.name, s.body])).toEqual([
      ["tidy-sql", "Keep queries short."],
      ["house-style", "Shop style."],
      ["shop-api", "Call /v2."],
    ]);
    expect(merged.router?.useJev).toBe(false);
    expect(mergeAgentConfig(shared, EMPTY_AGENT_CONFIG)).toEqual(shared);

    expect(parseProjectAgentConfig({ ...EMPTY_AGENT_CONFIG, roles: { backend: role("Mine.", ["tidy-sql"]) } }, defaults, shared)).toMatchObject({ ok: true });
    const missing = parseProjectAgentConfig({ ...EMPTY_AGENT_CONFIG, roles: { backend: role("Mine.", ["nope"]) } }, defaults, shared);
    expect(missing.ok).toBe(false);

    const view = projectAgentsView("shop", defaults, { version: 4, at: 1, summary: "s", config: shared }, { version: 2, at: 2, summary: "p", config: own }, [], models, false);
    expect(view.version).toBe(2);
    expect(view.scope).toEqual({ project: "shop", roles: ["planner"], skills: ["house-style", "shop-api"], router: true, shared: { version: 4, roles: ["backend"], skills: ["tidy-sql", "house-style"], router: false } });
    expect(view.roles.find((r) => r.role === "backend")).toMatchObject({ instructions: "Shared prompt.", skills: ["tidy-sql"] });
    expect(view.roles.find((r) => r.role === "planner")).toMatchObject({ instructions: "Plan for shop.", skills: ["shop-api"] });
    expect(view.router.useJev).toBe(false);
  });

  it("keeps project agent settings apart from the shared ones in one store", async () => {
    const store = new MemoryStore();
    const shared = new AgentSettings(store);
    const own = new AgentSettings(store, () => 1, "project/agents/");
    await shared.save(config, "shared", null);
    await own.save(EMPTY_AGENT_CONFIG, "own", null);
    expect((await shared.current()).summary).toBe("shared");
    expect((await own.current()).summary).toBe("own");
    expect(await own.history()).toHaveLength(1);
  });
});
