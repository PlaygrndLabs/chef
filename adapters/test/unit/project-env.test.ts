import { describe, expect, it } from "vitest";
import { aesCipher, applyEnvUpdate, envKeyBytes, envNames, mergeEnv, newEnvKey, revealEnv, viewEnv, viewProjectEnv, type StoredEnv } from "../../src/project-env.ts";
import { toPlan } from "../../src/llm-planner.ts";

async function cipher() {
  return aesCipher(envKeyBytes(newEnvKey()));
}

describe("project environment", () => {
  it("stores values sealed, shows plain values and only the names of secrets", async () => {
    const c = await cipher();
    const result = await applyEnvUpdate({}, { set: { STRIPE_SECRET_KEY: { value: "sk_live_1" }, API_URL: { value: "https://api.example.com", secret: false } } }, c, 5);
    if (!result.ok) throw new Error(result.error);
    expect(JSON.stringify(result.env)).not.toContain("sk_live_1");
    expect(result.env["STRIPE_SECRET_KEY"]?.secret).toBe(true);
    expect(envNames(result.env)).toEqual([
      { name: "API_URL", secret: false },
      { name: "STRIPE_SECRET_KEY", secret: true },
    ]);
    const view = await viewEnv(result.env, c, [{ name: "MAPS_KEY", features: ["map"] }]);
    expect(view.vars).toEqual([
      { name: "API_URL", secret: false, value: "https://api.example.com", updatedAt: 5 },
      { name: "STRIPE_SECRET_KEY", secret: true, value: null, hint: "…ve_1", updatedAt: 5 },
    ]);
    expect(view.needs).toEqual([{ name: "MAPS_KEY", features: ["map"] }]);
    expect((await revealEnv(result.env, c)).find((v) => v.name === "STRIPE_SECRET_KEY")?.value).toBe("sk_live_1");
  });

  it("gives a project the shared values and lets it override any of them", async () => {
    const c = await cipher();
    const shared = await applyEnvUpdate({}, { set: { SUPPORT_EMAIL: { value: "help@example.com", secret: false }, API_URL: { value: "https://shared.example", secret: false } } }, c, 1);
    const own = await applyEnvUpdate({}, { set: { API_URL: { value: "https://shop.example", secret: false }, STRIPE_KEY: { value: "sk_1" } } }, c, 2);
    if (!shared.ok || !own.ok) throw new Error("update failed");
    expect((await revealEnv(mergeEnv(shared.env, own.env), c)).map((v) => [v.name, v.value])).toEqual([
      ["API_URL", "https://shop.example"],
      ["STRIPE_KEY", "sk_1"],
      ["SUPPORT_EMAIL", "help@example.com"],
    ]);
    const view = await viewProjectEnv(own.env, shared.env, c, []);
    expect(view.vars.map((v) => [v.name, v.value, v.scope ?? "project"])).toEqual([
      ["API_URL", "https://shop.example", "overrides"],
      ["STRIPE_KEY", null, "project"],
      ["SUPPORT_EMAIL", "help@example.com", "shared"],
    ]);
  });

  it("replaces and removes values and refuses bad names", async () => {
    const c = await cipher();
    const first = await applyEnvUpdate({}, { set: { A_KEY: { value: "1" }, B_KEY: { value: "2" } } }, c, 1);
    if (!first.ok) throw new Error(first.error);
    const second = await applyEnvUpdate(first.env, { set: { A_KEY: { value: "3" } }, remove: ["B_KEY"] }, c, 2);
    if (!second.ok) throw new Error(second.error);
    expect(await revealEnv(second.env, c)).toEqual([{ name: "A_KEY", secret: true, value: "3" }]);
    const stored: StoredEnv = second.env;
    for (const body of [{ set: { "lower-case": { value: "x" } } }, { set: { STORE: { value: "x" } } }, { set: { A_KEY: { value: "" } } }, { nope: true }]) {
      expect((await applyEnvUpdate(stored, body, c, 3)).ok).toBe(false);
    }
  });

  it("cannot read values sealed with another key", async () => {
    const sealed = await (await cipher()).encrypt("secret");
    await expect((await cipher()).decrypt(sealed)).rejects.toThrow();
  });

  it("keeps the env names a feature already had and drops invalid ones from the planner", () => {
    const existing = { id: "pay", title: "Pay", status: "merged" as const, entrypoint: "POST /pay", revision: 1, shared: [], env: ["STRIPE_SECRET_KEY"], acceptance: [{ id: "AC1", text: "pays" }], body: "" };
    const plan = toPlan({ feature: { id: "pay", title: "Pay", entrypoint: "POST /pay", shared: [], env: ["STRIPE_WEBHOOK_SECRET", "not valid", "STRIPE_SECRET_KEY"], acceptance: [], body: "Pay" }, items: [] }, existing, "m");
    expect(plan.feature.env).toEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
  });
});
