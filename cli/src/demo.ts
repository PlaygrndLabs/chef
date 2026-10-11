import type { Tree } from "@kargah/core";
import type { Script } from "@kargah/core/fakes";

export function demoScript(files: Tree): Script {
  return (input) => {
    const prefix = `features/${input.featureId}/`;
    const changes: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const isTest = path.endsWith(".test.ts") || path.endsWith("/flow.ts");
      if (input.role === "test" ? isTest : !isTest) changes[path] = content;
    }
    return { changes, summary: `${input.role} work for ${input.featureId}` };
  };
}
