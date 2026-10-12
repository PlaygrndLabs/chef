import type { Script } from "@chef/core/fakes";
import { flow, implementation, tests, type BenchItem, type TestStyle } from "./items.ts";

const TEST_FEEDBACK = ["pass before the feature is implemented", "project lint rule"];
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

const RECALL = "Project memory that may apply";

function hasLesson(item: BenchItem, prompt: string): boolean {
  return prompt.includes(`### memory/lessons/${item.id}-`);
}

function feedback(prompt: string): string {
  const index = prompt.indexOf(RECALL);
  return index < 0 ? prompt : prompt.slice(0, index);
}

export function benchScript(items: readonly BenchItem[]): Script {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (input) => {
    const item = byId.get(input.featureId);
    if (!item) return { changes: {}, summary: `no bench item ${input.featureId}` };
    const dir = `features/${item.id}`;
    if (input.role === "test") {
      const told = TEST_FEEDBACK.some((f) => feedback(input.prompt).includes(f));
      const style = hasLesson(item, input.prompt) ? "good" : testStyle(item, input.attempt.index, told);
      return { changes: { [`${dir}/${item.id}.test.ts`]: tests(item, style), [`${dir}/flow.ts`]: flow(item) }, summary: `${style} tests for ${item.id}` };
    }
    if (input.role === "backend") {
      const buggy = !hasLesson(item, input.prompt) && writesBuggyCode(item, input.attempt.index, FAILURE_FEEDBACK.some((f) => feedback(input.prompt).includes(f)));
      return { changes: { [`${dir}/index.ts`]: implementation(item, buggy ? item.buggy : item.correct) }, summary: `${buggy ? "first" : "correct"} implementation of ${item.id}` };
    }
    return { changes: {}, summary: `${input.role} has nothing to do for ${item.id}` };
  };
}
