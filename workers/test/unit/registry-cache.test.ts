import { describe, expect, it } from "vitest";
import { registryFetch, registryItem, TAG_SECONDS, type CachedManifest, type LayerStore } from "../../src/registry-cache.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;
const HUB = "https://registry-1.docker.io";

function memoryStore() {
  const blobs = new Map<string, { type: string; bytes: Uint8Array }>();
  const manifests = new Map<string, CachedManifest>();
  const store: LayerStore = {
    async blob(digest) {
      const found = blobs.get(digest);
      return found ? new Response(found.bytes, { headers: { "content-type": found.type, "content-length": String(found.bytes.byteLength), "docker-content-digest": digest } }) : null;
    },
    async saveBlob(digest, _size, type, body) {
      blobs.set(digest, { type, bytes: new Uint8Array(await new Response(body).arrayBuffer()) });
    },
    manifest: async (key) => manifests.get(key) ?? null,
    saveManifest: async (key, manifest) => void manifests.set(key, manifest),
  };
  return { store, blobs, manifests };
}

function harness(answer: (request: Request) => Response | Promise<Response>) {
  const memory = memoryStore();
  const calls: { url: string; auth: string | null }[] = [];
  const pending: Promise<unknown>[] = [];
  let now = 1_000_000;
  const deps = {
    store: memory.store,
    upstream: async (request: Request) => {
      calls.push({ url: request.url, auth: request.headers.get("authorization") });
      return answer(request);
    },
    waitUntil: (work: Promise<unknown>) => void pending.push(work),
    now: () => now,
  };
  return { ...memory, calls, deps, settle: () => Promise.all(pending), later: (ms: number) => (now += ms) };
}

describe("image cache for the sandbox's registry pulls", () => {
  it("tells layers, pinned manifests and tagged manifests apart", () => {
    expect(registryItem(new URL(`${HUB}/v2/library/node/blobs/${DIGEST}`), null)).toEqual({ kind: "blob", key: DIGEST, digest: DIGEST });
    expect(registryItem(new URL(`${HUB}/v2/library/node/blobs/latest`), null)).toBeNull();
    expect(registryItem(new URL(`${HUB}/v2/library/node/manifests/22`), "application/json")).toEqual({ kind: "manifest", key: "registry-1.docker.io/library/node:22|application/json", pinned: false });
    expect(registryItem(new URL(`${HUB}/v2/library/node/manifests/${DIGEST}`), null)).toMatchObject({ pinned: true });
    expect(registryItem(new URL(`${HUB}/v2/`), null)).toBeNull();
  });

  it("follows the registry's redirect without the token, keeps the layer and serves it from the cache next time", async () => {
    const h = harness((request) =>
      request.url.startsWith(HUB) ? new Response(null, { status: 307, headers: { location: "https://cdn.example/layer?sig=1" } }) : new Response("layer-bytes", { headers: { "content-length": "11" } }),
    );
    const first = await registryFetch(new Request(`${HUB}/v2/library/node/blobs/${DIGEST}`, { headers: { authorization: "Bearer t" } }), h.deps);
    expect(await first.text()).toBe("layer-bytes");
    await h.settle();
    expect(h.calls).toEqual([{ url: `${HUB}/v2/library/node/blobs/${DIGEST}`, auth: "Bearer t" }, { url: "https://cdn.example/layer?sig=1", auth: null }]);
    const again = await registryFetch(new Request(`${HUB}/v2/library/node/blobs/${DIGEST}`), h.deps);
    expect(await again.text()).toBe("layer-bytes");
    expect(again.headers.get("docker-content-digest")).toBe(DIGEST);
    expect(h.calls).toHaveLength(2);
    const head = await registryFetch(new Request(`${HUB}/v2/library/node/blobs/${DIGEST}`, { method: "HEAD" }), h.deps);
    expect(head.status).toBe(200);
    expect(h.calls).toHaveLength(2);
  });

  it("serves a tag from the cache for a while, then asks again and falls back to the cache when the registry limits pulls", async () => {
    let limited = false;
    const h = harness(() => (limited ? new Response("too many", { status: 429 }) : new Response('{"v":1}', { headers: { "content-type": "application/vnd.oci.image.index.v1+json", "docker-content-digest": DIGEST } })));
    const url = `${HUB}/v2/library/node/manifests/22`;
    expect(await (await registryFetch(new Request(url), h.deps)).text()).toBe('{"v":1}');
    const cached = await registryFetch(new Request(url), h.deps);
    expect(cached.headers.get("x-chef-cache")).toBe("hit");
    expect(cached.headers.get("content-type")).toBe("application/vnd.oci.image.index.v1+json");
    expect(h.calls).toHaveLength(1);
    h.later(TAG_SECONDS * 1000 + 1);
    limited = true;
    const fallback = await registryFetch(new Request(url), h.deps);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toBe('{"v":1}');
    expect(h.calls).toHaveLength(2);
  });

  it("passes everything else straight through and caches nothing it cannot check", async () => {
    const h = harness(() => new Response("{}", { status: 401 }));
    expect((await registryFetch(new Request(`${HUB}/v2/`), h.deps)).status).toBe(401);
    expect((await registryFetch(new Request(`${HUB}/v2/library/node/blobs/${DIGEST}`, { headers: { range: "bytes=0-9" } }), h.deps)).status).toBe(401);
    expect((await registryFetch(new Request(`${HUB}/v2/library/node/manifests/22`), h.deps)).status).toBe(401);
    expect(h.manifests.size).toBe(0);
    expect(h.blobs.size).toBe(0);
  });
});
