import { describe, expect, it } from "vitest";
import { fixture, scriptFromFixture, templateTree, world } from "../harness.ts";

const KIT = ["shared/ui.md", "shared/ui.ts"];

describe("adding new template files to an existing project", () => {
  it("commits only the files main is missing", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")) });
    const template = templateTree();
    const old = Object.fromEntries(Object.entries(template).filter(([path]) => !KIT.includes(path)));
    await w.orchestrator.bootstrap({ ...old, "shared/ui.md": "kept" });
    const kit = Object.fromEntries(KIT.map((path) => [path, template[path] as string]));
    expect(await w.orchestrator.addMissingFiles(kit, "Add the UI kit")).toEqual(["shared/ui.ts"]);
    const main = (await w.orchestrator.mainTree()).tree;
    expect(main["shared/ui.ts"]).toBe(template["shared/ui.ts"]);
    expect(main["shared/ui.md"]).toBe("kept");
    expect(await w.orchestrator.addMissingFiles(kit, "Add the UI kit")).toEqual([]);
  });

  it("leaves projects that do not match alone", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")) });
    await w.orchestrator.bootstrap({ "README.md": "imported" });
    expect(await w.orchestrator.addMissingFiles({ "shared/ui.ts": "x" }, "Add the UI kit", (tree) => tree["shared/http.ts"] !== undefined)).toEqual([]);
    expect(Object.keys((await w.orchestrator.mainTree()).tree)).not.toContain("shared/ui.ts");
  });
});
