import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brandFiles } from "../../core/src/brand/files.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node cli/src/brand.ts <folder>");
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
for (const [name, content] of Object.entries(brandFiles())) writeFileSync(join(dir, name), typeof content === "string" ? `${content}\n` : content);
