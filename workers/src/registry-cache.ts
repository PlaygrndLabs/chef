export const REGISTRY_HOSTS: ReadonlySet<string> = new Set(["registry-1.docker.io", "ghcr.io", "quay.io", "mcr.microsoft.com", "public.ecr.aws", "gcr.io", "registry.k8s.io"]);

export const TAG_SECONDS = 6 * 60 * 60;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const BLOB = /^\/v2\/(.+)\/blobs\/([^/]+)$/;
const MANIFEST = /^\/v2\/(.+)\/manifests\/([^/]+)$/;
const KEPT_HEADERS = ["content-type", "docker-content-digest", "content-length"];

export type RegistryItem =
  | { readonly kind: "blob"; readonly key: string; readonly digest: string }
  | { readonly kind: "manifest"; readonly key: string; readonly pinned: boolean };

export interface CachedManifest {
  readonly body: ArrayBuffer;
  readonly headers: Readonly<Record<string, string>>;
  readonly at: number;
}

export interface LayerStore {
  blob(digest: string): Promise<Response | null>;
  saveBlob(digest: string, size: number, type: string, body: ReadableStream<Uint8Array>): Promise<void>;
  manifest(key: string): Promise<CachedManifest | null>;
  saveManifest(key: string, manifest: CachedManifest): Promise<void>;
}

export interface RegistryDeps {
  readonly store: LayerStore;
  readonly upstream: (request: Request) => Promise<Response>;
  readonly waitUntil: (work: Promise<unknown>) => void;
  readonly now: () => number;
}

export function registryItem(url: URL, accept: string | null): RegistryItem | null {
  const blob = BLOB.exec(url.pathname);
  if (blob) return DIGEST.test(blob[2] as string) ? { kind: "blob", key: blob[2] as string, digest: blob[2] as string } : null;
  const manifest = MANIFEST.exec(url.pathname);
  if (!manifest) return null;
  const ref = manifest[2] as string;
  return { kind: "manifest", key: `${url.hostname}/${manifest[1]}:${ref}|${accept ?? ""}`, pinned: DIGEST.test(ref) };
}

function kept(headers: Headers): Record<string, string> {
  return Object.fromEntries(KEPT_HEADERS.flatMap((name) => {
    const value = headers.get(name);
    return value ? [[name, value]] : [];
  }));
}

function answer(method: string, body: BodyInit | null, headers: Readonly<Record<string, string>>): Response {
  return new Response(method === "HEAD" ? null : body, { status: 200, headers: { ...headers, "x-chef-cache": "hit" } });
}

async function upstreamOrNull(deps: RegistryDeps, request: Request): Promise<Response | null> {
  try {
    return await deps.upstream(request);
  } catch {
    return null;
  }
}

export async function followed(request: Request, upstream: (request: Request) => Promise<Response>): Promise<Response> {
  let response = await upstream(request);
  for (let hops = 0; hops < 5 && response.status >= 300 && response.status < 400 && response.headers.has("location"); hops++) {
    const next = new URL(response.headers.get("location") as string, request.url);
    if (next.protocol !== "https:") break;
    response = await upstream(new Request(next, { method: request.method, redirect: "manual" }));
  }
  return response;
}

async function blobRequest(request: Request, digest: string, deps: RegistryDeps): Promise<Response> {
  const cached = await deps.store.blob(digest);
  if (cached) {
    if (request.method !== "HEAD") return cached;
    await cached.body?.cancel();
    return new Response(null, { status: 200, headers: cached.headers });
  }
  const response = await followed(request, deps.upstream);
  const size = Number(response.headers.get("content-length"));
  if (request.method !== "GET" || response.status !== 200 || !response.body || !Number.isSafeInteger(size) || size <= 0) return response;
  const [client, copy] = response.body.tee();
  deps.waitUntil(deps.store.saveBlob(digest, size, response.headers.get("content-type") ?? "application/octet-stream", copy).catch(() => copy.cancel().catch(() => undefined)));
  return new Response(client, { status: 200, headers: response.headers });
}

async function manifestRequest(request: Request, item: { readonly key: string; readonly pinned: boolean }, deps: RegistryDeps): Promise<Response> {
  const cached = await deps.store.manifest(item.key);
  if (cached && (item.pinned || deps.now() - cached.at < TAG_SECONDS * 1000)) return answer(request.method, cached.body, cached.headers);
  const response = await upstreamOrNull(deps, request);
  if (response?.status === 200 && request.method === "GET") {
    const body = await response.arrayBuffer();
    const headers = kept(response.headers);
    await deps.store.saveManifest(item.key, { body, headers, at: deps.now() });
    return new Response(body, { status: 200, headers: response.headers });
  }
  if (cached && (!response || response.status === 429 || response.status >= 500)) return answer(request.method, cached.body, cached.headers);
  return response ?? new Response("the registry did not answer", { status: 502 });
}

export async function registryFetch(request: Request, deps: RegistryDeps): Promise<Response> {
  if ((request.method !== "GET" && request.method !== "HEAD") || request.headers.has("range")) return deps.upstream(request);
  const item = registryItem(new URL(request.url), request.headers.get("accept"));
  if (!item) return deps.upstream(request);
  return item.kind === "blob" ? blobRequest(request, item.digest, deps) : manifestRequest(request, item, deps);
}
