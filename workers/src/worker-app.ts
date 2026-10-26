export const WORKER_APP = "worker-app";
const FILES = `${WORKER_APP}/`;
const CHUNK_BYTES = 1_000_000;
const MAIN = "chef-main.js";

export type ModuleKind = "js" | "cjs" | "text" | "data" | "wasm";

export interface WorkerObject {
  readonly binding: string;
  readonly className: string;
}

export interface WorkerBundle {
  readonly mainModule: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags: readonly string[];
  readonly vars: Readonly<Record<string, string>>;
  readonly objects: readonly WorkerObject[];
  readonly notFound: "none" | "single-page-application";
}

export interface WorkerAsset {
  readonly type: string;
  readonly size: number;
  readonly etag: string;
  readonly chunks: number;
}

export interface WorkerAppMeta extends WorkerBundle {
  readonly commitId: string;
  readonly codeId: string;
  readonly env: Readonly<Record<string, string>>;
  readonly modules: Readonly<Record<string, { readonly kind: ModuleKind; readonly chunks: number }>>;
  readonly assets: Readonly<Record<string, WorkerAsset>>;
}

export interface WorkerAppFiles {
  readonly modules: ReadonlyMap<string, Uint8Array>;
  readonly assets: ReadonlyMap<string, Uint8Array>;
}

const TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function contentType(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  return TYPES[extension] ?? "application/octet-stream";
}

export function moduleKind(name: string): ModuleKind | null {
  if (/\.m?js$/.test(name)) return "js";
  if (name.endsWith(".cjs")) return "cjs";
  if (name.endsWith(".wasm")) return "wasm";
  if (/\.(txt|html|sql)$/.test(name)) return "text";
  if (name.endsWith(".bin")) return "data";
  return null;
}

export function assetPath(meta: Pick<WorkerAppMeta, "assets" | "notFound">, pathname: string, navigation: boolean): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}.html`, `${path}/index.html`];
  const found = candidates.find((candidate) => meta.assets[candidate] !== undefined);
  if (found) return found;
  return meta.notFound === "single-page-application" && navigation && meta.assets["/index.html"] ? "/index.html" : null;
}

export function wrapperModule(bundle: Pick<WorkerBundle, "mainModule" | "objects">): string {
  const main = JSON.stringify(`./${bundle.mainModule}`);
  return `import * as app from ${main};
const OBJECTS = ${JSON.stringify(bundle.objects.map((o) => o.binding))};
function namespace(binding, env) {
  const stub = (name) => new Proxy({}, { get(_, method) {
    if (method === "fetch") return (input, init) => env.CHEF_OBJECTS.fetchObject(binding, name, new Request(input, init));
    if (method === "then") return undefined;
    if (method === "name") return name;
    return (...args) => env.CHEF_OBJECTS.callObject(binding, name, String(method), args);
  } });
  const id = (name) => ({ name, toString: () => name, equals: (other) => other?.name === name });
  return { idFromName: id, idFromString: id, newUniqueId: () => id(crypto.randomUUID().replaceAll("-", "")), get: (target) => stub(target?.name ?? String(target)), getByName: stub, jurisdiction() { return this; } };
}
function appEnv(env) {
  const scoped = { ...env };
  delete scoped.CHEF_OBJECTS;
  for (const binding of OBJECTS) scoped[binding] = namespace(binding, env);
  return scoped;
}
export * from ${main};
export default { fetch(request, env, ctx) { return app.default.fetch(request, appEnv(env), ctx); } };
`;
}

async function hash(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fileKey(commitId: string, group: "m" | "a", path: string, chunk: number): string {
  return `${FILES}${commitId}/${group}${path.startsWith("/") ? "" : "/"}${path}#${chunk}`;
}

async function putChunks(storage: DurableObjectStorage, commitId: string, group: "m" | "a", path: string, bytes: Uint8Array): Promise<number> {
  const chunks = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES));
  for (let i = 0; i < chunks; i++) await storage.put(fileKey(commitId, group, path, i), bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
  return chunks;
}

async function readChunks(storage: DurableObjectStorage, commitId: string, group: "m" | "a", path: string, chunks: number): Promise<Uint8Array> {
  const keys = Array.from({ length: chunks }, (_, i) => fileKey(commitId, group, path, i));
  const found = await storage.get<Uint8Array>(keys);
  const parts = keys.map((key) => found.get(key));
  if (parts.some((part) => part === undefined)) throw new Error(`the stored app is missing part of ${path}`);
  const out = new Uint8Array(parts.reduce((sum, part) => sum + (part?.byteLength ?? 0), 0));
  let at = 0;
  for (const part of parts as Uint8Array[]) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export async function saveWorkerApp(storage: DurableObjectStorage, input: { readonly commitId: string; readonly env: Readonly<Record<string, string>>; readonly bundle: WorkerBundle; readonly files: WorkerAppFiles }): Promise<WorkerAppMeta> {
  const { commitId, bundle, files } = input;
  const modules: Record<string, { kind: ModuleKind; chunks: number }> = {};
  for (const [name, bytes] of files.modules) {
    const kind = moduleKind(name);
    if (kind) modules[name] = { kind, chunks: await putChunks(storage, commitId, "m", name, bytes) };
  }
  if (!modules[bundle.mainModule]) throw new Error(`the built app has no ${bundle.mainModule}`);
  const assets: Record<string, WorkerAsset> = {};
  for (const [path, bytes] of files.assets) assets[path] = { type: contentType(path), size: bytes.byteLength, etag: await hash(bytes), chunks: await putChunks(storage, commitId, "a", path, bytes) };
  const codeId = `${commitId}:${await hash(JSON.stringify({ bundle, env: input.env, modules }))}`;
  const meta: WorkerAppMeta = { ...bundle, commitId, codeId, env: input.env, modules, assets };
  await storage.put(WORKER_APP, meta);
  const stale = [...(await storage.list({ prefix: FILES })).keys()].filter((key) => !key.startsWith(`${FILES}${commitId}/`));
  for (let i = 0; i < stale.length; i += 128) await storage.delete(stale.slice(i, i + 128));
  return meta;
}

export async function dropWorkerApp(storage: DurableObjectStorage): Promise<void> {
  await storage.delete(WORKER_APP);
  const keys = [...(await storage.list({ prefix: FILES })).keys()];
  for (let i = 0; i < keys.length; i += 128) await storage.delete(keys.slice(i, i + 128));
}

export async function workerCode(storage: DurableObjectStorage, meta: WorkerAppMeta, objects: Fetcher): Promise<WorkerLoaderWorkerCode> {
  const modules: Record<string, WorkerLoaderModule> = { [MAIN]: { js: wrapperModule(meta) } };
  for (const [name, { kind, chunks }] of Object.entries(meta.modules)) {
    const bytes = await readChunks(storage, meta.commitId, "m", name, chunks);
    const text = () => new TextDecoder().decode(bytes);
    modules[name] = kind === "js" ? { js: text() } : kind === "cjs" ? { cjs: text() } : kind === "text" ? { text: text() } : kind === "wasm" ? { wasm: bytes.buffer as ArrayBuffer } : { data: bytes.buffer as ArrayBuffer };
  }
  return { compatibilityDate: meta.compatibilityDate, compatibilityFlags: [...meta.compatibilityFlags], mainModule: MAIN, modules, env: { ...meta.vars, ...meta.env, CHEF_OBJECTS: objects } };
}

export async function assetResponse(storage: DurableObjectStorage, meta: WorkerAppMeta, path: string, request: Request): Promise<Response> {
  const asset = meta.assets[path] as WorkerAsset;
  const etag = `"${asset.etag}"`;
  const headers = { "content-type": asset.type, etag, "cache-control": "public, max-age=0, must-revalidate" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  if (request.method === "HEAD") return new Response(null, { headers: { ...headers, "content-length": String(asset.size) } });
  return new Response(await readChunks(storage, meta.commitId, "a", path, asset.chunks), { headers });
}
