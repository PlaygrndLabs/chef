import type { TestContext } from "node:test";
import { createApp, type Env, type Feature } from "../shared/http.ts";
import { MemoryStore, type Store } from "../shared/storage.ts";
import { ORIGIN, openPage, type OpenPage } from "./browser.ts";

export interface TestApp {
  readonly store: Store;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  open(path: string): Promise<OpenPage>;
}

export function testApp(t: Pick<TestContext, "after">, features: readonly Feature[], env: Env = {}): TestApp {
  const store = new MemoryStore();
  const app = createApp(features, store, env);
  return {
    store,
    fetch: (path, init) => app(new Request(new URL(path, ORIGIN), init)),
    open: async (path) => {
      const opened = await openPage(features, path, store, env);
      t.after(() => opened.close());
      return opened;
    },
  };
}
