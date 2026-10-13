import { describe, expect, it } from "vitest";
import { lintSpecFiles, parseFeature, renderFeature } from "../../src/spec/index.ts";
import { todoSpec } from "../harness.ts";
import { envNeeds, parseDotEnv } from "../../src/env/env.ts";

describe("spec", () => {
  it("round-trips a feature through markdown", () => {
    const parsed = parseFeature(renderFeature(todoSpec));
    expect(parsed).toEqual({ ok: true, spec: todoSpec });
  });

  it("reports schema, naming and duplicate problems", () => {
    const good = renderFeature(todoSpec);
    const { problems } = lintSpecFiles({
      "spec/features/todo-add.md": good,
      "spec/features/other.md": good,
      "spec/features/bad.md": "---\nid: bad\n---\n",
    });
    const messages = problems.map((p) => `${p.path}: ${p.message}`);
    expect(messages).toContain('spec/features/other.md: id "todo-add" must match file name "other"');
    expect(messages.some((m) => m.includes(": duplicate id \"todo-add\""))).toBe(true);
    expect(messages.some((m) => m.startsWith("spec/features/bad.md: title"))).toBe(true);
  });
});

describe("feature env names", () => {
  it("round-trips env names and rejects lower-case ones", () => {
    const source = renderFeature({ id: "pay", title: "Pay", status: "building", entrypoint: "POST /pay", revision: 1, shared: [], env: ["STRIPE_SECRET_KEY"], acceptance: [{ id: "AC1", text: "pays" }], body: "Pay" });
    expect(source).toContain("env:\n  - STRIPE_SECRET_KEY");
    const parsed = parseFeature(source);
    expect(parsed.ok && parsed.spec.env).toEqual(["STRIPE_SECRET_KEY"]);
    expect(parseFeature(source.replace("STRIPE_SECRET_KEY", "stripe")).ok).toBe(false);
    const plain = parseFeature(source.replace("env:\n  - STRIPE_SECRET_KEY\n", ""));
    expect(plain.ok && plain.spec.env).toEqual([]);
  });

  it("lists missing keys per feature and reads .env text", () => {
    const features = [
      { id: "pay", env: ["STRIPE_SECRET_KEY", "API_URL"] },
      { id: "refund", env: ["STRIPE_SECRET_KEY"] },
    ];
    expect(envNeeds(features, [{ name: "API_URL", secret: false }])).toEqual([{ name: "STRIPE_SECRET_KEY", features: ["pay", "refund"] }]);
    expect(parseDotEnv('# comment\nexport A=1\nB = "two words"\nC=\'x\'\nD=plain # note\nbad line\n')).toEqual({ A: "1", B: "two words", C: "x", D: "plain" });
  });
});
