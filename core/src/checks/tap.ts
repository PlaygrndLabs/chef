import type { TestCase } from "../ports/check-runner.ts";

export function parseTap(output: string): TestCase[] {
  const cases: TestCase[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(not )?ok \d+ - (.*?)(?:\s+# (?:SKIP|TODO)\b.*)?$/.exec(line);
    if (!match) continue;
    cases.push({ name: unescape(match[2] ?? ""), ok: match[1] === undefined });
  }
  return cases;
}

function unescape(name: string): string {
  return name.replace(/\\([\\#])/g, "$1");
}
