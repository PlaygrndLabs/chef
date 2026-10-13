import assert from "node:assert/strict";
import { test } from "node:test";
import { featureIds, renderRegistry } from "./gen.ts";

test("registry lists every feature folder with an index", () => {
  const paths = ["features/notes/index.ts", "features/add-todo/index.ts", "features/add-todo/flow.ts", "shared/http.ts"];
  assert.deepEqual(featureIds(paths), ["add-todo", "notes"]);
  assert.match(renderRegistry(paths), /import \{ feature as addTodo \} from "\.\.\/features\/add-todo\/index\.ts";/);
  assert.match(renderRegistry(paths), /\[addTodo, notes\]/);
});
