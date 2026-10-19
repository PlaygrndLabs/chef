import { describe, expect, it } from "vitest";
import { removeTranscripts, transcriptFetch, transcriptPath, type TranscriptStore } from "../../src/transcripts.ts";

const BASE = "http://198.18.0.2";

function memoryStore(pageSize = 1000) {
  const objects = new Map<string, string>();
  const store: TranscriptStore = {
    async put(key, body) {
      objects.set(key, new TextDecoder().decode(body));
    },
    async get(key) {
      const text = objects.get(key);
      return text === undefined ? null : { arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
    },
    async list({ prefix, cursor }) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix) && (!cursor || key > cursor)).sort();
      const page = keys.slice(0, pageSize);
      const truncated = keys.length > pageSize;
      return { objects: page.map((key) => ({ key })), truncated, ...(truncated ? { cursor: page.at(-1) as string } : {}) };
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
  return { store, objects };
}

describe("transcripts", () => {
  it("saves a sandbox's transcript file under its project only", async () => {
    const { store, objects } = memoryStore();
    const path = "s1--frontend/claude/projects/-workspace-s1--frontend-repo/0b1c.jsonl";
    const saved = await transcriptFetch(new Request(`${BASE}/${path}`, { method: "PUT", body: '{"type":"user"}\n' }), store, "notes");
    expect(saved.status).toBe(204);
    expect(objects.get(`notes/${path}`)).toBe('{"type":"user"}\n');
  });

  it("reads a saved file back for the same project only", async () => {
    const { store, objects } = memoryStore();
    objects.set("notes/s1/turns/t1.json", '{"turn":"t1"}');
    objects.set("other/s1/turns/t2.json", "{}");
    const read = await transcriptFetch(new Request(`${BASE}/s1/turns/t1.json`), store, "notes");
    expect(read.status).toBe(200);
    expect(await read.text()).toBe('{"turn":"t1"}');
    expect((await transcriptFetch(new Request(`${BASE}/s1/turns/t2.json`), store, "notes")).status).toBe(404);
  });

  it("refuses paths that would leave the project, and anything but GET and PUT", async () => {
    const { store, objects } = memoryStore();
    for (const pathname of ["/", "/a/../../other/x", "/a/%2e%2e/b", "/a//b", "/a\\b", "/%E0%A4%A"]) expect(transcriptPath(pathname)).toBeNull();
    expect((await transcriptFetch(new Request(`${BASE}/s1/x.jsonl`, { method: "DELETE" }), store, "notes")).status).toBe(405);
    expect((await transcriptFetch(new Request(`${BASE}/`, { method: "PUT", body: "x" }), store, "notes")).status).toBe(400);
    await transcriptFetch(new Request(`${BASE}/s1/%2e%2e/%2e%2e/other/x`, { method: "PUT", body: "x" }), store, "notes");
    expect([...objects.keys()]).toEqual(["notes/other/x"]);
  });

  it("removes every transcript of a removed project and keeps other projects'", async () => {
    const { store, objects } = memoryStore(2);
    for (const key of ["notes/s1/a", "notes/s1/b", "notes/s2/c", "notes-old/s1/a"]) objects.set(key, "x");
    expect(await removeTranscripts(store, "notes")).toBe(3);
    expect([...objects.keys()]).toEqual(["notes-old/s1/a"]);
  });
});
