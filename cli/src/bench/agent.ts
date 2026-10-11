import type { Script } from "@kargah/core/fakes";
import { flow, implementation, tests, type BenchItem, type TestStyle } from "./items.ts";

const RED_FEEDBACK = "pass before the feature is implemented";
const FAILURE_FEEDBACK = ["Merge gate failed", "Main went red"];

export function testStyle(item: BenchItem, attempt: number, toldTestsAreVacuous: boolean): TestStyle {
  if (item.fault === "vacuous-test" && !toldTestsAreVacuous) return "vacuous";
  if (item.fault === "missed-edge" && attempt === 1) return "weak";
  return "good";
}

export function writesBuggyCode(item: BenchItem, attempt: number, toldItFailed: boolean): boolean {
  if (toldItFailed || item.fault === "none") return false;
  return !(item.fault === "missed-edge" && attempt > 1);
}

export function benchScript(items: readonly BenchItem[]): Script {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (input) => {
    const item = byId.get(input.featureId);
    if (!item) return { changes: {}, summary: `no bench item ${input.featureId}` };
    const dir = `features/${item.id}`;
    if (input.role === "test") {
      const style = testStyle(item, input.attempt.index, input.prompt.includes(RED_FEEDBACK));
      return { changes: { [`${dir}/${item.id}.test.ts`]: tests(item, style), [`${dir}/flow.ts`]: flow(item) }, summary: `${style} tests for ${item.id}` };
    }
    if (input.role === "backend") {
      const buggy = writesBuggyCode(item, input.attempt.index, FAILURE_FEEDBACK.some((f) => input.prompt.includes(f)));
      return { changes: { [`${dir}/index.ts`]: implementation(item, buggy ? item.buggy : item.correct) }, summary: `${buggy ? "first" : "correct"} implementation of ${item.id}` };
    }
    return { changes: {}, summary: `${input.role} has nothing to do for ${item.id}` };
  };
}
