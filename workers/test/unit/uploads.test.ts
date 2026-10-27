import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, readUpload, saveUpload, uploadFetch, type UploadStore } from "../../src/uploads.ts";

function memoryStore(): UploadStore & { readonly keys: () => string[] } {
  const objects = new Map<string, ArrayBuffer>();
  return {
    keys: () => [...objects.keys()],
    put: async (key, body) => void objects.set(key, body),
    get: async (key) => {
      const body = objects.get(key);
      return body ? { arrayBuffer: async () => body } : null;
    },
  };
}

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const upload = (body: BodyInit, type: string) => new Request("https://chef.test/api/projects/demo/uploads", { method: "POST", headers: { "content-type": type }, body });

describe("uploads", () => {
  it("keeps an image under the project by its content hash and serves it back with its type", async () => {
    const store = memoryStore();
    const saved = await saveUpload(upload(png, "image/png"), store, "demo");
    expect(saved.status).toBe(201);
    const { name, path } = (await saved.json()) as { name: string; path: string };
    expect(name).toMatch(/^[0-9a-f]{20}\.png$/);
    expect(path).toBe(`uploads/${name}`);
    expect(store.keys()).toEqual([`demo/uploads/${name}`]);
    const again = (await (await saveUpload(upload(png, "image/png"), store, "demo")).json()) as { name: string };
    expect(again.name).toBe(name);
    const served = await readUpload(store, "demo", name);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
    expect((await readUpload(store, "other", name)).status).toBe(404);
  });

  it("refuses what is not an image, an empty body and anything over 10 MB", async () => {
    const store = memoryStore();
    expect((await saveUpload(upload("<svg/>", "image/svg+xml"), store, "demo")).status).toBe(415);
    expect((await saveUpload(upload("hi", "text/plain"), store, "demo")).status).toBe(415);
    expect((await saveUpload(upload(new Uint8Array(), "image/jpeg"), store, "demo")).status).toBe(400);
    expect((await saveUpload(upload(new Uint8Array(MAX_UPLOAD_BYTES + 1), "image/webp"), store, "demo")).status).toBe(413);
    expect(store.keys()).toEqual([]);
  });

  it("lets a sandbox read its project's uploads by name and nothing else", async () => {
    const store = memoryStore();
    const { name } = (await (await saveUpload(upload(png, "image/png"), store, "demo")).json()) as { name: string };
    expect((await uploadFetch(new Request(`http://198.18.0.4/${name}`), store, "demo")).status).toBe(200);
    expect((await uploadFetch(new Request(`http://198.18.0.4/${name}`, { method: "PUT", body: "x" }), store, "demo")).status).toBe(405);
    expect((await uploadFetch(new Request("http://198.18.0.4/../transcripts/x.jsonl"), store, "demo")).status).toBe(404);
    expect((await uploadFetch(new Request(`http://198.18.0.4/${name}`), store, "other")).status).toBe(404);
  });
});
