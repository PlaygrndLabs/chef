import { DurableObject } from "cloudflare:workers";
import type { CachedManifest, LayerStore } from "./registry-cache.ts";

const CHUNK = 1_900_000;
const MAX_BLOB = 4 * 1024 * 1024 * 1024;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_MS = 24 * 60 * 60 * 1000;
const STALE_WRITE_MS = 60 * 60 * 1000;
const META = "meta";
const MANIFEST = "manifest";

interface BlobMeta {
  readonly size: number;
  readonly type: string;
  readonly done: boolean;
  readonly at: number;
  readonly used: number;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ImageLayers extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS chunks (i INTEGER PRIMARY KEY, data BLOB NOT NULL)");
  }

  async read(): Promise<{ readonly size: number; readonly type: string; readonly body: ReadableStream<Uint8Array> } | null> {
    const meta = await this.ctx.storage.get<BlobMeta>(META);
    if (!meta?.done) return null;
    const now = Date.now();
    if (now - meta.used > TOUCH_MS) await this.used({ ...meta, used: now });
    const sql = this.ctx.storage.sql;
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const row = sql.exec<{ data: ArrayBuffer }>("SELECT data FROM chunks WHERE i = ?", i++).toArray()[0];
        if (row) controller.enqueue(new Uint8Array(row.data));
        else controller.close();
      },
    });
    return { size: meta.size, type: meta.type, body };
  }

  async write(digest: string, size: number, type: string, body: ReadableStream<Uint8Array>): Promise<boolean> {
    const now = Date.now();
    const meta = await this.ctx.storage.get<BlobMeta>(META);
    if (size > MAX_BLOB || (meta && (meta.done || now - meta.at < STALE_WRITE_MS))) {
      await body.cancel();
      return false;
    }
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM chunks");
    await this.ctx.storage.put(META, { size, type, done: false, at: now, used: now } satisfies BlobMeta);
    await this.ctx.storage.setAlarm(now + KEEP_MS);
    const hasher = new crypto.DigestStream("SHA-256");
    const hashing = hasher.getWriter();
    const buffer = new Uint8Array(CHUNK);
    let filled = 0;
    let row = 0;
    let total = 0;
    try {
      for await (const piece of body) {
        await hashing.write(piece);
        total += piece.byteLength;
        let offset = 0;
        while (offset < piece.byteLength) {
          const take = Math.min(CHUNK - filled, piece.byteLength - offset);
          buffer.set(piece.subarray(offset, offset + take), filled);
          filled += take;
          offset += take;
          if (filled === CHUNK) {
            sql.exec("INSERT INTO chunks (i, data) VALUES (?, ?)", row++, buffer.slice(0, filled).buffer);
            filled = 0;
          }
        }
      }
      if (filled > 0) sql.exec("INSERT INTO chunks (i, data) VALUES (?, ?)", row++, buffer.slice(0, filled).buffer);
      await hashing.close();
      if (total !== size || `sha256:${hex(await hasher.digest)}` !== digest) throw new Error("the layer did not match its digest");
    } catch {
      await this.ctx.storage.deleteAll();
      return false;
    }
    await this.used({ size, type, done: true, at: now, used: now });
    return true;
  }

  async manifest(): Promise<CachedManifest | null> {
    return (await this.ctx.storage.get<CachedManifest>(MANIFEST)) ?? null;
  }

  async saveManifest(manifest: CachedManifest): Promise<void> {
    await this.ctx.storage.put(MANIFEST, manifest);
    await this.ctx.storage.setAlarm(manifest.at + KEEP_MS);
  }

  override async alarm(): Promise<void> {
    const meta = await this.ctx.storage.get<BlobMeta>(META);
    const manifest = await this.ctx.storage.get<CachedManifest>(MANIFEST);
    const last = Math.max(meta?.used ?? 0, manifest?.at ?? 0);
    if (Date.now() - last >= KEEP_MS) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(last + KEEP_MS);
  }

  private async used(meta: BlobMeta): Promise<void> {
    await this.ctx.storage.put(META, meta);
    await this.ctx.storage.setAlarm(meta.used + KEEP_MS);
  }
}

export function layerStore(layers: DurableObjectNamespace<ImageLayers>): LayerStore {
  const of = (key: string) => layers.get(layers.idFromName(key));
  return {
    async blob(digest) {
      const found = await of(`blob:${digest}`).read();
      return found ? new Response(found.body, { headers: { "content-type": found.type, "content-length": String(found.size), "docker-content-digest": digest } }) : null;
    },
    async saveBlob(digest, size, type, body) {
      await of(`blob:${digest}`).write(digest, size, type, body);
    },
    manifest: (key) => of(`manifest:${key}`).manifest(),
    saveManifest: (key, manifest) => of(`manifest:${key}`).saveManifest(manifest),
  };
}
