import { describe, expect, it } from "vitest";
import { layerCacheFetch, manifestKey, type CachedManifest, type LayerStore } from "../../src/layer-cache.ts";

const CACHE = "http://198.18.0.1";
const BYTES = new TextEncoder().encode("layer-bytes");

async function sha256(bytes: Uint8Array): Promise<string> {
  return `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function memoryStore() {
  const blobs = new Map<string, { type: string; bytes: Uint8Array }>();
  const manifests = new Map<string, CachedManifest>();
  const store: LayerStore = {
    async blob(digest) {
      const found = blobs.get(digest);
      return found ? new Response(found.bytes, { headers: { "content-type": found.type, "content-length": String(found.bytes.byteLength), "docker-content-digest": digest } }) : null;
    },
    async saveBlob(digest, size, type, body) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.byteLength !== size || (await sha256(bytes)) !== digest) return false;
      blobs.set(digest, { type, bytes });
      return true;
    },
    manifest: async (key) => manifests.get(key) ?? null,
    saveManifest: async (key, manifest) => void manifests.set(key, manifest),
  };
  return { store, blobs, manifests };
}

describe("image layer cache behind the sandbox's Docker Hub mirror", () => {
  it("keeps a layer only when it matches its digest and serves it back", async () => {
    const { store } = memoryStore();
    const digest = await sha256(BYTES);
    expect((await layerCacheFetch(new Request(`${CACHE}/blobs/${digest}`), store, "p")).status).toBe(404);
    const wrong = await layerCacheFetch(new Request(`${CACHE}/blobs/${digest}`, { method: "PUT", body: "other-bytes", headers: { "x-chef-size": "11" } }), store, "p");
    expect(wrong.status).toBe(409);
    const saved = await layerCacheFetch(new Request(`${CACHE}/blobs/${digest}`, { method: "PUT", body: BYTES, headers: { "x-chef-size": "11", "content-type": "application/octet-stream" } }), store, "p");
    expect(saved.status).toBe(201);
    const back = await layerCacheFetch(new Request(`${CACHE}/blobs/${digest}`), store, "another-project");
    expect(await back.text()).toBe("layer-bytes");
    expect(back.headers.get("docker-content-digest")).toBe(digest);
    const head = await layerCacheFetch(new Request(`${CACHE}/blobs/${digest}`, { method: "HEAD" }), store, "p");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("11");
  });

  it("shares a manifest named by its digest, but keeps a tag to the project that saved it", async () => {
    const { store } = memoryStore();
    const body = new TextEncoder().encode('{"v":1}');
    const digest = await sha256(body);
    const pinned = `library/node:${digest}|application/vnd.oci.image.index.v1+json`;
    const put = (key: string, scope: string, bytes: Uint8Array) =>
      layerCacheFetch(new Request(`${CACHE}/manifests?key=${encodeURIComponent(key)}`, { method: "PUT", body: bytes, headers: { "x-chef-headers": JSON.stringify({ "content-type": "application/vnd.oci.image.index.v1+json", "x-other": "dropped" }) } }), store, scope);
    const get = (key: string, scope: string) => layerCacheFetch(new Request(`${CACHE}/manifests?key=${encodeURIComponent(key)}`), store, scope);
    expect((await put(pinned, "a", new TextEncoder().encode('{"v":2}'))).status).toBe(409);
    expect((await put(pinned, "a", body)).status).toBe(201);
    const shared = await get(pinned, "b");
    expect(await shared.text()).toBe('{"v":1}');
    expect(shared.headers.get("content-type")).toBe("application/vnd.oci.image.index.v1+json");
    expect(shared.headers.get("x-other")).toBeNull();
    expect(Number(shared.headers.get("x-chef-at"))).toBeGreaterThan(0);
    const tag = "library/node:22|application/json";
    expect((await put(tag, "a", body)).status).toBe(201);
    expect((await get(tag, "a")).status).toBe(200);
    expect((await get(tag, "b")).status).toBe(404);
  });

  it("refuses anything that is not a layer or a manifest", async () => {
    const { store } = memoryStore();
    expect(manifestKey("library/node:22|x", "p")).toEqual({ key: "p|library/node:22|x", digest: null });
    expect(manifestKey("../../etc|x", "p")).toBeNull();
    expect((await layerCacheFetch(new Request(`${CACHE}/blobs/latest`), store, "p")).status).toBe(400);
    expect((await layerCacheFetch(new Request(`${CACHE}/manifests?key=nope`), store, "p")).status).toBe(400);
    expect((await layerCacheFetch(new Request(`${CACHE}/v2/`), store, "p")).status).toBe(404);
    expect((await layerCacheFetch(new Request(`${CACHE}/blobs/x`, { method: "DELETE" }), store, "p")).status).toBe(405);
  });
});
