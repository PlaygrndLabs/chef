import { createApp, type Env } from "../shared/http.ts";
import { DurableStore, MemoryStore, type StoreNamespace } from "../shared/storage.ts";
import { features } from "./registry.gen.ts";

export { StoreObject } from "../shared/storage.ts";

interface Bindings {
  readonly STORE?: StoreNamespace;
  readonly [name: string]: unknown;
}

const memory = new MemoryStore();

export default {
  fetch(request: Request, env: Bindings): Promise<Response> {
    return createApp(features, env.STORE ? new DurableStore(env.STORE) : memory, settings(env))(request);
  },
};

function settings(env: Bindings): Env {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
