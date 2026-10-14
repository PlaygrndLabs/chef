import assert from "node:assert/strict";
import { test } from "node:test";
import { DurableStore, StoreObject, type ObjectStorage, type StoreNamespace } from "./storage.ts";

function namespace(): StoreNamespace {
  const data = new Map<string, unknown>();
  const storage: ObjectStorage = {
    get: async (key) => data.get(key),
    put: async (key, value) => void data.set(key, value),
    delete: async (key) => data.delete(key),
    list: async ({ prefix }) => new Map([...data.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))),
  };
  const objects = new Map<string, StoreObject>();
  return {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (input, init) => {
        const name = String(id);
        const object = objects.get(name) ?? new StoreObject({ storage });
        objects.set(name, object);
        return object.fetch(new Request(input, init));
      },
    }),
  };
}

test("keeps what one request saves for the next request", async () => {
  const shared = namespace();
  await new DurableStore(shared).put("todos/b", { text: "second" });
  await new DurableStore(shared).put("todos/a", { text: "first" });
  await new DurableStore(shared).put("notes/x", { text: "other" });
  const later = new DurableStore(shared);
  assert.deepEqual(await later.get("todos/a"), { text: "first" });
  assert.deepEqual(await later.list("todos/"), [{ text: "first" }, { text: "second" }]);
  await later.delete("todos/a");
  assert.equal(await later.get("todos/a"), null);
  assert.deepEqual(await later.list("todos/"), [{ text: "second" }]);
});
