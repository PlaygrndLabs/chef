export const ENGINE_PATH = /^\/(?:api|agents|preview)(?:\/|$)/;
export const ORIGIN_HEADER = "x-chef-origin";

const DROP_REQUEST = new Set(["host", "cookie", "authorization", "origin", "referer", "content-length", ORIGIN_HEADER]);
const DROP_RESPONSE = new Set(["set-cookie", "content-length", "content-encoding", "transfer-encoding", "strict-transport-security"]);

export interface EngineTarget {
  readonly url: string;
  readonly secret: string;
}

export async function proxy(request: Request, engine: EngineTarget, publicOrigin: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!DROP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("authorization", `Bearer ${engine.secret}`);
  headers.set(ORIGIN_HEADER, publicOrigin);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetchImpl(`${engine.url}${url.pathname}${url.search}`, { method: request.method, headers, redirect: "manual", ...(hasBody ? { body: request.body, duplex: "half" } : {}) } as RequestInit);
  } catch {
    return Response.json({ error: "could not reach your chef engine; try again in a minute" }, { status: 502 });
  }
  if (upstream.status === 101) return upstream;
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (DROP_RESPONSE.has(key.toLowerCase())) return;
    if (key.toLowerCase() === "location" && value.startsWith(engine.url)) out.set(key, value.slice(engine.url.length) || "/");
    else out.set(key, value);
  });
  return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
