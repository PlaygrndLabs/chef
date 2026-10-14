export function safeReturn(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function manifestPage(action: string, manifest: unknown): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>chef</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f6f4;color:#1d1d1b}form{display:grid;gap:12px;width:min(360px,90vw)}button{font:inherit;padding:10px;border-radius:0;background:#1d1d1b;color:#fff;border:0}@media (prefers-color-scheme:dark){body{background:#151514;color:#eee}button{background:#eee;color:#151514}}</style></head><body><form id="manifest" method="post" action="${escape(action)}"><p>Taking you to GitHub to create chef's app…</p><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>Continue to GitHub</button></form><script>document.getElementById("manifest").submit()</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function publicOrigin(request: Request): string {
  const own = new URL(request.url).origin;
  const forwarded = request.headers.get("x-chef-origin");
  if (!forwarded) return own;
  try {
    const url = new URL(forwarded);
    return url.protocol === "https:" && url.origin === forwarded ? forwarded : own;
  } catch {
    return own;
  }
}
