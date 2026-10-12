import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { checkTree, formatProblems } from "./lint/checks/code-rules.ts";

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const tree = {};
for (const path of listed.split("\0").filter(Boolean)) if (!path.startsWith("node_modules") && statSync(path, { throwIfNoEntry: false })?.isFile()) tree[path] = readFileSync(path, "utf8");
const problems = checkTree(tree);
process.stdout.write(`${formatProblems(problems) || "no problems"}\n`);
process.exitCode = problems.length ? 1 : 0;
