import { createApp, type Env } from "../shared/http.ts";
import { KvStore, MemoryStore, type KvLike } from "../shared/storage.ts";
import { features } from "./registry.gen.ts";

interface Bindings {
  readonly STORE?: KvLike;
  readonly [name: string]: unknown;
}

const memory = new MemoryStore();

export default {
  fetch(request: Request, env: Bindings): Promise<Response> {
    return createApp(features, env.STORE ? new KvStore(env.STORE) : memory, settings(env))(request);
  },
};

function settings(env: Bindings): Env {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
