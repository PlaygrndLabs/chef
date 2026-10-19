import { describe, expect, it } from "vitest";
import { removeTranscripts, saveTranscript, transcriptPath, type TranscriptStore } from "../../src/transcripts.ts";

const BASE = "http://198.18.0.2";

function memoryStore(pageSize = 1000) {
  const objects = new Map<string, string>();
  const store: TranscriptStore = {
    async put(key, body) {
      objects.set(key, new TextDecoder().decode(body));
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
    const saved = await saveTranscript(new Request(`${BASE}/${path}`, { method: "PUT", body: '{"type":"user"}\n' }), store, "notes");
    expect(saved.status).toBe(204);
    expect(objects.get(`notes/${path}`)).toBe('{"type":"user"}\n');
  });

  it("refuses paths that would leave the project, and anything but PUT", async () => {
    const { store, objects } = memoryStore();
    for (const pathname of ["/", "/a/../../other/x", "/a/%2e%2e/b", "/a//b", "/a\\b", "/%E0%A4%A"]) expect(transcriptPath(pathname)).toBeNull();
    expect((await saveTranscript(new Request(`${BASE}/s1/x.jsonl`), store, "notes")).status).toBe(405);
    expect((await saveTranscript(new Request(`${BASE}/`, { method: "PUT", body: "x" }), store, "notes")).status).toBe(400);
    await saveTranscript(new Request(`${BASE}/s1/%2e%2e/%2e%2e/other/x`, { method: "PUT", body: "x" }), store, "notes");
    expect([...objects.keys()]).toEqual(["notes/other/x"]);
  });

  it("removes every transcript of a removed project and keeps other projects'", async () => {
    const { store, objects } = memoryStore(2);
    for (const key of ["notes/s1/a", "notes/s1/b", "notes/s2/c", "notes-old/s1/a"]) objects.set(key, "x");
    expect(await removeTranscripts(store, "notes")).toBe(3);
    expect([...objects.keys()]).toEqual(["notes-old/s1/a"]);
  });
});
