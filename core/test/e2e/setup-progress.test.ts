import { describe, expect, it } from "vitest";
import type { SetupProgress } from "../../src/setup/progress.ts";
import { fixture, scriptFromFixture, templateTree, world } from "../harness.ts";

function recorder(): SetupProgress & { readonly lines: string[] } {
  const lines: string[] = [];
  return { lines, step: (label) => lines.push(`step ${label}`), log: (text) => lines.push(`log ${text}`) };
}

describe("project setup progress", () => {
  it("reports each bootstrap step with what it did", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")) });
    const progress = recorder();
    const commitId = await w.orchestrator.bootstrap(templateTree(), progress);
    const steps = progress.lines.filter((l) => l.startsWith("step "));
    expect(steps).toEqual(["step Create the project's git repository", "step Copy chef's starter app", "step Save the first commit", "step Index the project memory"]);
    expect(progress.lines).toContain(`log Committed ${Object.keys((await w.orchestrator.mainTree()).tree).length} files to main as ${commitId.slice(0, 7)}`);
    expect(progress.lines.some((l) => /^log \+ /.test(l))).toBe(true);
    expect(progress.lines.at(-1)).toMatch(/^log Indexed \d+ documents?$/);
  });
});
