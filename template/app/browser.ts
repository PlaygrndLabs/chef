import { chromium, type Browser, type Page } from "playwright";
import { createApp, type Feature } from "../shared/http.ts";
import { MemoryStore, type Store } from "../shared/storage.ts";

export const ORIGIN = "http://app.test";

export interface OpenPage {
  readonly page: Page;
  readonly store: Store;
  close(): Promise<void>;
}

let shared: Promise<Browser> | null = null;

function browser(): Promise<Browser> {
  shared ??= chromium.launch({ headless: true, chromiumSandbox: false });
  return shared;
}

export async function openPage(features: readonly Feature[], path: string, store: Store = new MemoryStore()): Promise<OpenPage> {
  const app = createApp(features, store);
  const context = await (await browser()).newContext({ baseURL: ORIGIN });
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!request.url().startsWith(ORIGIN)) return route.abort();
    const body = request.postDataBuffer();
    const response = await app(new Request(request.url(), { method: request.method(), headers: request.headers(), ...(body ? { body: new Uint8Array(body) } : {}) }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage();
  await page.goto(path);
  return { page, store, close: () => context.close() };
}

export async function closeBrowser(): Promise<void> {
  const current = shared;
  shared = null;
  if (current) await (await current).close();
}
