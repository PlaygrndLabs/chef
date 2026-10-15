import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TAG_MS = 6 * 60 * 60 * 1000;
const TOKEN_MS = 4 * 60 * 1000;
const PASSED = ["content-type", "content-length", "content-range", "accept-ranges", "docker-content-digest", "www-authenticate"];

function challenge(header) {
  const fields = Object.fromEntries([...(header ?? "").matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  return /^bearer /i.test(header ?? "") && fields.realm?.startsWith("https://") ? fields : null;
}

function passed(headers) {
  return Object.fromEntries(PASSED.flatMap((name) => (headers.get(name) ? [[name, headers.get(name)]] : [])));
}

export function mirror({ cache, hub, now = Date.now }) {
  const tokens = new Map();

  async function upstream(path, init, name) {
    const scope = `repository:${name}:pull`;
    const token = tokens.get(scope);
    const send = (bearer) => fetch(`${hub}${path}`, { ...init, redirect: "manual", headers: { ...init.headers, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } });
    let response = await send(token && token.until > now() ? token.value : null);
    const asked = response.status === 401 ? challenge(response.headers.get("www-authenticate")) : null;
    if (asked) {
      const url = new URL(asked.realm);
      if (asked.service) url.searchParams.set("service", asked.service);
      url.searchParams.set("scope", asked.scope ?? scope);
      const got = await fetch(url);
      const value = got.ok ? ((await got.json()).token ?? null) : null;
      if (value) {
        tokens.set(scope, { value, until: now() + TOKEN_MS });
        response = await send(value);
      }
    }
    for (let hops = 0; hops < 5 && response.status >= 300 && response.status < 400 && response.headers.has("location"); hops++) {
      const next = new URL(response.headers.get("location"), `${hub}${path}`);
      if (next.protocol !== "https:") break;
      response = await fetch(next, { method: init.method, headers: init.headers?.range ? { range: init.headers.range } : {}, redirect: "manual" });
    }
    return response;
  }

  async function cached(url, init) {
    const quiet = new AbortController();
    const timer = setTimeout(() => quiet.abort(), 5000);
    try {
      const response = await fetch(`${cache}${url}`, { ...init, signal: quiet.signal });
      return response.ok ? response : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function save(url, init) {
    fetch(`${cache}${url}`, { method: "PUT", ...init }).then((r) => r.body?.cancel(), () => undefined);
  }

  async function send(res, method, status, headers, body) {
    res.writeHead(status, headers);
    if (method === "HEAD" || !body) {
      if (typeof body?.cancel === "function") await body.cancel().catch(() => undefined);
      res.end();
      return;
    }
    if (body instanceof Uint8Array) res.end(body);
    else Readable.fromWeb(body).on("error", () => res.destroy()).pipe(res);
  }

  async function blob(req, res, name, digest) {
    const range = req.headers.range;
    const hit = range ? null : await cached(`/blobs/${digest}`, { method: req.method });
    if (hit) return send(res, req.method, 200, passed(hit.headers), hit.body);
    const response = await upstream(req.url, { method: req.method, headers: range ? { range } : {} }, name);
    const size = Number(response.headers.get("content-length"));
    let body = response.body;
    if (req.method === "GET" && !range && response.status === 200 && body && Number.isSafeInteger(size) && size > 0) {
      const [client, copy] = body.tee();
      body = client;
      save(`/blobs/${digest}`, { body: copy, duplex: "half", headers: { "x-chef-size": String(size), "content-type": response.headers.get("content-type") ?? "application/octet-stream" } });
    }
    return send(res, req.method, response.status, passed(response.headers), body);
  }

  async function manifest(req, res, name, ref) {
    const accept = req.headers.accept ?? "";
    const key = `/manifests?key=${encodeURIComponent(`${name}:${ref}|${accept}`)}`;
    const hit = await cached(key, { method: "GET" });
    const kept = hit ? { at: Number(hit.headers.get("x-chef-at")), headers: passed(hit.headers), body: new Uint8Array(await hit.arrayBuffer()) } : null;
    const answer = (entry) => send(res, req.method, 200, { ...entry.headers, "content-length": String(entry.body.byteLength), "x-chef-cache": "hit" }, entry.body);
    if (kept && (DIGEST.test(ref) || now() - kept.at < TAG_MS)) return answer(kept);
    const response = await upstream(req.url, { method: req.method, headers: { accept } }, name).catch(() => null);
    if (response?.status === 200 && req.method === "GET") {
      const body = new Uint8Array(await response.arrayBuffer());
      const headers = passed(response.headers);
      save(key, { body, headers: { "x-chef-headers": JSON.stringify(headers) } });
      return send(res, "GET", 200, { ...headers, "content-length": String(body.byteLength) }, body);
    }
    if (kept && (!response || response.status === 429 || response.status >= 500)) {
      await response?.body?.cancel();
      return answer(kept);
    }
    if (!response) return send(res, req.method, 502, {}, null);
    return send(res, req.method, response.status, passed(response.headers), response.body);
  }

  return async (req, res) => {
    try {
      const path = new URL(req.url, "http://mirror").pathname;
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, req.method, 405, {}, null);
      if (path === "/v2/" || path === "/v2") return send(res, req.method, 200, { "content-type": "application/json", "docker-distribution-api-version": "registry/2.0" }, new TextEncoder().encode("{}"));
      const blobPath = /^\/v2\/(.+)\/blobs\/([^/]+)$/.exec(path);
      if (blobPath && DIGEST.test(blobPath[2])) return await blob(req, res, blobPath[1], blobPath[2]);
      const manifestPath = /^\/v2\/(.+)\/manifests\/([^/]+)$/.exec(path);
      if (manifestPath) return await manifest(req, res, manifestPath[1], manifestPath[2]);
      return send(res, req.method, 404, {}, null);
    } catch (error) {
      console.error(`mirror ${req.method} ${req.url}: ${error}`);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createServer(mirror({ cache: "http://198.18.0.1", hub: "https://registry-1.docker.io" })).listen(5000, "127.0.0.1");
}
