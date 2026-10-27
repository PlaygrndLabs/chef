export const UPLOADS_ADDRESS = "198.18.0.4";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const TYPES: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const NAME = /^[0-9a-f]{20}\.(png|jpg|webp|gif|avif)$/;

export interface UploadStore {
  put(key: string, body: ArrayBuffer): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface Upload {
  readonly name: string;
  readonly path: string;
}

const keyOf = (project: string, name: string) => `${project}/uploads/${name}`;

function typeOf(name: string): string {
  const ext = name.split(".").at(-1);
  return Object.entries(TYPES).find(([, known]) => known === ext)?.[0] ?? "application/octet-stream";
}

export async function saveUpload(request: Request, store: UploadStore, project: string): Promise<Response> {
  const ext = TYPES[(request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""];
  if (!ext) return Response.json({ error: "attach a png, jpg, webp, gif or avif image" }, { status: 415 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) return Response.json({ error: "images can be up to 10 MB" }, { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return Response.json({ error: "the image is empty" }, { status: 400 });
  if (body.byteLength > MAX_UPLOAD_BYTES) return Response.json({ error: "images can be up to 10 MB" }, { status: 413 });
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const name = `${digest.slice(0, 20)}.${ext}`;
  await store.put(keyOf(project, name), body);
  return Response.json({ name, path: `uploads/${name}` } satisfies Upload, { status: 201 });
}

export async function readUpload(store: UploadStore, project: string, name: string): Promise<Response> {
  if (!NAME.test(name)) return new Response("no such upload", { status: 404 });
  const object = await store.get(keyOf(project, name));
  if (!object) return new Response("no such upload", { status: 404 });
  return new Response(await object.arrayBuffer(), { headers: { "content-type": typeOf(name), "cache-control": "private, max-age=31536000, immutable" } });
}

export function uploadFetch(request: Request, store: UploadStore, project: string): Promise<Response> | Response {
  if (request.method !== "GET") return new Response("uploads are read-only here", { status: 405 });
  return readUpload(store, project, new URL(request.url).pathname.replace(/^\//, ""));
}
