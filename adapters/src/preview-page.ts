export function buildingPage(input: { readonly status: "building" | "failed" | "missing"; readonly key: string; readonly error?: string }): Response {
  const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const title = input.status === "building" ? "Waking up this preview" : input.status === "failed" ? "This preview could not start" : "No preview yet";
  const detail =
    input.status === "building"
      ? "It was asleep to save resources. Chef is building it again from the latest commit of this feature. The page opens by itself when it is ready."
      : input.status === "failed"
        ? `Chef tried to build it and got this error:<pre>${escape(input.error ?? "")}</pre><a href="?retry=1">Try again</a>`
        : "This feature has no preview branch yet.";
  const refresh = input.status === "building" ? '<meta http-equiv="refresh" content="4">' : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}<title>${title}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fafafa;color:#18181b}main{max-width:32rem;padding:24px}h1{font-size:18px}pre{white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:0;font-size:12px}@media (prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}pre{background:#27272a}}</style></head><body><main><h1>${title}</h1><p>${detail}</p><p><small>${escape(input.key)}</small></p></main></body></html>`;
  return new Response(html, { status: input.status === "missing" ? 404 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function previewPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\s\\]/.test(raw)) return "";
  return raw.slice(0, 300);
}

export type PreviewAnswer = { readonly status: "ready"; readonly url: string; readonly commitId: string } | { readonly status: "building"; readonly since: number } | { readonly status: "failed"; readonly error: string } | { readonly status: "missing" };

export function previewResponse(state: PreviewAnswer, input: { readonly key: string; readonly path: string; readonly asState: boolean; readonly now: number; readonly enter?: string }): Response {
  if (input.asState) return Response.json(state.status === "building" ? { ...state, elapsedMs: Math.max(0, input.now - state.since) } : state.status === "ready" && input.enter ? { ...state, enter: input.enter } : state, { headers: { "cache-control": "no-store" } });
  if (state.status === "ready") return new Response(null, { status: 302, headers: { location: input.enter ?? `${state.url.replace(/\/$/, "")}${input.path}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  return buildingPage({ status: state.status, key: input.key, ...(state.status === "failed" ? { error: state.error } : {}) });
}
