import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { featureIds, laneLayout, renderRegistry } from "./gen.ts";

test("registry lists every feature folder with an index", () => {
  const paths = ["features/notes/index.ts", "features/add-todo/index.ts", "features/add-todo/flow.ts", "shared/http.ts"];
  assert.deepEqual(featureIds(paths), ["add-todo", "notes"]);
  assert.match(renderRegistry(paths), /import \{ feature as addTodo \} from "\.\.\/features\/add-todo\/index\.ts";/);
  assert.match(renderRegistry(paths), /\[addTodo, notes\]/);
});

test("lane layout gives every role its own routes file that the feature index combines", async () => {
  const layout = laneLayout("todo-list", "Todo list", ["backend", "frontend"], ["features/todo-list/todo-list.test.ts", "features/todo-list/flow.ts"]);
  assert.ok(layout);
  assert.deepEqual(layout.parts, { backend: "features/todo-list/backend/routes.ts", frontend: "features/todo-list/frontend/routes.ts" });
  const dir = mkdtempSync(join(tmpdir(), "lanes-"));
  for (const [path, content] of Object.entries(layout.changes)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  mkdirSync(join(dir, "shared"), { recursive: true });
  for (const file of ["http.ts", "storage.ts"]) copyFileSync(join(import.meta.dirname, "..", "shared", file), join(dir, "shared", file));
  const { feature } = (await import(pathToFileURL(join(dir, "features/todo-list/index.ts")).href)) as { feature: { id: string; routes: unknown[] } };
  assert.equal(feature.id, "todo-list");
  assert.deepEqual(feature.routes, []);
});

test("lane layout leaves a feature that already has code alone", () => {
  assert.equal(laneLayout("todo-list", "Todo list", ["backend", "frontend"], ["features/todo-list/index.ts"]), null);
});
