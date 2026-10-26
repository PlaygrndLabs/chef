import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { CLIENT_PATH, createApp, type Env, type Feature } from "../shared/http.ts";
import { MemoryStore, type Store } from "../shared/storage.ts";
import { FONTS_PATH } from "../shared/fonts.ts";
import { appFonts, bundleClient } from "./client.ts";
import type { FontAssets } from "./fonts.ts";

export const ORIGIN = "http://app.test";
export const STEP_TIMEOUT_MS = 5000;

export interface OpenPage {
  readonly page: Page;
  readonly store: Store;
  close(): Promise<void>;
}

let shared: Promise<Browser> | null = null;
const clients = new Map<string, Promise<string>>();
const fonts = new Map<string, Promise<FontAssets>>();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function clientCode(root: string): Promise<string> {
  let code = clients.get(root);
  if (!code) {
    code = bundleClient(root, { minify: false });
    clients.set(root, code);
  }
  return code;
}

function fontsOf(root: string): Promise<FontAssets> {
  let found = fonts.get(root);
  if (!found) {
    found = appFonts(root).catch(() => ({ css: "", files: new Map<string, string>() }));
    fonts.set(root, found);
  }
  return found;
}

async function fontFile(root: string, pathname: string): Promise<{ readonly type: string; readonly body: Buffer | string } | null> {
  if (pathname === FONTS_PATH) return { type: "text/css; charset=utf-8", body: (await fontsOf(root)).css };
  const source = pathname.startsWith("/fonts/") ? (await fontsOf(root)).files.get(pathname.slice("/fonts/".length)) : undefined;
  return source ? { type: source.endsWith(".woff") ? "font/woff" : "font/woff2", body: await readFile(source) } : null;
}

function browser(): Promise<Browser> {
  shared ??= chromium.launch({ headless: true, chromiumSandbox: false });
  return shared;
}

export async function openPage(features: readonly Feature[], path: string, store: Store = new MemoryStore(), env: Env = {}, root = ROOT): Promise<OpenPage> {
  const app = createApp(features, store, env);
  const code = await clientCode(root);
  const context = await (await browser()).newContext({ baseURL: ORIGIN });
  context.setDefaultTimeout(STEP_TIMEOUT_MS);
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!request.url().startsWith(ORIGIN)) return route.abort();
    const { pathname } = new URL(request.url());
    if (pathname === CLIENT_PATH) return route.fulfill({ status: 200, headers: { "content-type": "text/javascript; charset=utf-8" }, body: code });
    const font = await fontFile(root, pathname);
    if (font) return route.fulfill({ status: 200, headers: { "content-type": font.type }, body: font.body });
    const body = request.postDataBuffer();
    const response = await app(new Request(request.url(), { method: request.method(), headers: request.headers(), ...(body ? { body: new Uint8Array(body) } : {}) }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(path);
  await page.waitForFunction(() => document.getElementById("root")?.hasChildNodes() ?? true).catch(() => {
    throw new Error(`the page ${path} did not render${errors.length ? `: ${errors.join("; ")}` : ""}`);
  });
  return { page, store, close: () => context.close() };
}

export async function closeBrowser(): Promise<void> {
  const current = shared;
  shared = null;
  if (current) await (await current).close();
}
