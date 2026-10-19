export const TRANSCRIPT_ADDRESS = "198.18.0.2";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PATH = 1024;

export interface TranscriptStore {
  put(key: string, body: ArrayBuffer): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: readonly { key: string }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string[]): Promise<void>;
}

export function transcriptPath(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname).replace(/^\//, "");
  } catch {
    return null;
  }
  if (!path || path.length > MAX_PATH || path.includes("\\") || [...path].some((char) => char.charCodeAt(0) < 32)) return null;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..") ? path : null;
}

export async function transcriptFetch(request: Request, store: TranscriptStore, project: string): Promise<Response> {
  if (request.method !== "PUT" && request.method !== "GET") return new Response("only GET and PUT", { status: 405 });
  const path = transcriptPath(new URL(request.url).pathname);
  if (!path) return new Response("a relative file path is needed", { status: 400 });
  if (request.method === "GET") {
    const object = await store.get(`${project}/${path}`);
    return object ? new Response(await object.arrayBuffer()) : new Response("no such transcript file", { status: 404 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return new Response("too large", { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("too large", { status: 413 });
  await store.put(`${project}/${path}`, body);
  return new Response(null, { status: 204 });
}

export async function removeTranscripts(store: TranscriptStore, project: string): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await store.list({ prefix: `${project}/`, ...(cursor ? { cursor } : {}) });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) await store.delete(keys);
    removed += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}
