import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTree } from "../../cli/src/fs.ts";

const root = join(import.meta.dirname, "..", "..");
const target = join(root, "workers", "src", "embedded.gen.ts");
const template = readTree(join(root, "template"), (p) => !p.startsWith("node_modules/"));
const agents = readTree(join(root, "agents"));
const content = `export const templateFiles: Readonly<Record<string, string>> = ${JSON.stringify(template, null, 2)};\n\nexport const agentFiles: Readonly<Record<string, string>> = ${JSON.stringify(agents, null, 2)};\n`;
const check = process.argv.includes("--check");
const current = (() => {
  try {
    return readFileSync(target, "utf8");
  } catch {
    return "";
  }
})();
if (check) {
  if (current !== content) {
    process.stderr.write("workers/src/embedded.gen.ts is out of date; run pnpm --filter @kargah/workers embed\n");
    process.exitCode = 1;
  }
} else if (current !== content) writeFileSync(target, content);
