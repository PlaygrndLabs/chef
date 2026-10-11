import { createApp } from "../shared/http.ts";
import { KvStore, MemoryStore, type KvLike } from "../shared/storage.ts";
import { features } from "./registry.gen.ts";

interface Env {
  readonly STORE?: KvLike;
}

const memory = new MemoryStore();

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createApp(features, env.STORE ? new KvStore(env.STORE) : memory)(request);
  },
};
