import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readTree } from "../../cli/src/fs.ts";

const root = join(import.meta.dirname, "..", "..");
const target = join(root, "workers", "src", "embedded.gen.ts");
const template = readTree(join(root, "template"), (p) => !p.startsWith("node_modules/"));
const agents = readTree(join(root, "agents"));
const content = `export const templateFiles: Readonly<Record<string, string>> = ${JSON.stringify(template, null, 2)};\n\nexport const agentFiles: Readonly<Record<string, string>> = ${JSON.stringify(agents, null, 2)};\n`;
const check = process.argv.includes("--check");
const lintFiles = ["checks/code-rules.ts", "checks/project-rules.ts", "util/glob.ts"];
const outputs: [string, string][] = [
  [target, content],
  ...lintFiles.map((file): [string, string] => [join(root, "workers", "sandbox", "lint", file), readFileSync(join(root, "core", "src", file), "utf8")]),
];
for (const [path, expected] of outputs) {
  const current = (() => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  })();
  if (current === expected) continue;
  if (check) {
    process.stderr.write(`${path.slice(root.length + 1)} is out of date; run pnpm --filter @chef/workers embed\n`);
    process.exitCode = 1;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, expected);
  }
}
