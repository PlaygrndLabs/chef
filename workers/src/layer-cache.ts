export const LAYER_CACHE_ADDRESS = "198.18.0.1";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MANIFEST_KEY = /^([a-z0-9][a-z0-9._/-]{0,255}):([A-Za-z0-9_][A-Za-z0-9_.:-]{0,127})\|[^\n]{0,1024}$/;
const MAX_MANIFEST = 1024 * 1024;

export interface CachedManifest {
  readonly body: ArrayBuffer;
  readonly headers: Readonly<Record<string, string>>;
  readonly at: number;
}

export interface LayerStore {
  blob(digest: string): Promise<Response | null>;
  saveBlob(digest: string, size: number, type: string, body: ReadableStream<Uint8Array>): Promise<boolean>;
  manifest(key: string): Promise<CachedManifest | null>;
  saveManifest(key: string, manifest: CachedManifest): Promise<void>;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function manifestKey(key: string, scope: string): { readonly key: string; readonly digest: string | null } | null {
  const ref = MANIFEST_KEY.exec(key)?.[2];
  if (!ref) return null;
  return DIGEST.test(ref) ? { key, digest: ref } : { key: `${scope}|${key}`, digest: null };
}

async function blobs(request: Request, digest: string, store: LayerStore): Promise<Response> {
  if (request.method === "PUT") {
    const size = Number(request.headers.get("x-chef-size"));
    if (!request.body || !Number.isSafeInteger(size) || size <= 0) return new Response("x-chef-size and a body are needed", { status: 400 });
    const saved = await store.saveBlob(digest, size, request.headers.get("content-type") ?? "application/octet-stream", request.body);
    return new Response(null, { status: saved ? 201 : 409 });
  }
  const found = await store.blob(digest);
  if (!found) return new Response(null, { status: 404 });
  if (request.method === "GET") return found;
  await found.body?.cancel();
  return new Response(null, { status: 200, headers: found.headers });
}

async function manifests(request: Request, key: string, digest: string | null, store: LayerStore): Promise<Response> {
  if (request.method === "PUT") {
    const body = await request.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_MANIFEST) return new Response("the manifest is empty or too big", { status: 400 });
    if (digest && `sha256:${hex(await crypto.subtle.digest("SHA-256", body))}` !== digest) return new Response("the manifest does not match its digest", { status: 409 });
    let headers: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(request.headers.get("x-chef-headers") ?? "{}");
      headers = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => ["content-type", "docker-content-digest"].includes(entry[0]) && typeof entry[1] === "string"));
    } catch {
      return new Response("x-chef-headers is not JSON", { status: 400 });
    }
    await store.saveManifest(key, { body, headers, at: Date.now() });
    return new Response(null, { status: 201 });
  }
  const found = await store.manifest(key);
  if (!found) return new Response(null, { status: 404 });
  return new Response(request.method === "GET" ? found.body : null, { headers: { ...found.headers, "x-chef-at": String(found.at) } });
}

export async function layerCacheFetch(request: Request, store: LayerStore, scope: string): Promise<Response> {
  if (!["GET", "HEAD", "PUT"].includes(request.method)) return new Response(null, { status: 405 });
  const url = new URL(request.url);
  const blob = /^\/blobs\/([^/]+)$/.exec(url.pathname);
  if (blob) return DIGEST.test(blob[1] as string) ? blobs(request, blob[1] as string, store) : new Response("not a sha256 digest", { status: 400 });
  if (url.pathname === "/manifests") {
    const item = manifestKey(url.searchParams.get("key") ?? "", scope);
    return item ? manifests(request, item.key, item.digest, store) : new Response("not a manifest key", { status: 400 });
  }
  return new Response(null, { status: 404 });
}
