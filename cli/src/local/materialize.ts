import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Tree } from "@kargah/core";

export interface Workdir {
  readonly dir: string;
  dispose(): Promise<void>;
}

export async function materialize(tree: Tree, nodeModules: string | null): Promise<Workdir> {
  const dir = await mkdtemp(join(tmpdir(), "kargah-"));
  for (const [path, content] of Object.entries(tree)) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (nodeModules) await symlink(nodeModules, join(dir, "node_modules"), "dir");
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}
