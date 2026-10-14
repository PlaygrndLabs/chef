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

export function tapFailures(output: string, blockLines = 40, totalLines = 150): string {
  const lines = output.split("\n");
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)not ok \d+ - /.exec(lines[i] as string);
    if (!head) continue;
    const end = `${head[1] ?? ""}  ...`;
    const block = [lines[i] as string];
    for (let j = i + 1; j < lines.length && lines[j] !== end && block.length < blockLines; j++) block.push(lines[j] as string);
    blocks.push(block.join("\n"));
  }
  return blocks.join("\n").split("\n").slice(0, totalLines).join("\n");
}
