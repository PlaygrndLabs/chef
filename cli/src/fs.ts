import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Tree } from "@chef/core";

const SKIP = new Set(["node_modules", ".git", ".wrangler", "dist", "coverage", ".chef"]);

export function readTree(dir: string, filter: (path: string) => boolean = () => true): Tree {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const path = relative(dir, full).split("\\").join("/");
        if (filter(path) && statSync(full).size < 1_000_000) out[path] = readFileSync(full, "utf8");
      }
    }
  };
  walk(dir);
  return out;
}
