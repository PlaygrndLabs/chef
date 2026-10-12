const COOKIE = "chef_access";

async function sessionToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("chef dashboard session")));
  return [...signature].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function loginPage(failed: boolean): Response {
  const note = failed ? `<p class="error">Wrong password.</p>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>chef</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f6f4;color:#1d1d1b}form{display:grid;gap:12px;width:min(320px,90vw)}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #c9c9c4}button{background:#1d1d1b;color:#fff;border:0}.error{color:#b42318;margin:0}@media (prefers-color-scheme:dark){body{background:#151514;color:#eee}input{background:#222;color:#eee;border-color:#444}button{background:#eee;color:#151514}}</style></head>
<body><form method="post" action="/login"><h1>chef</h1>${note}<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required><button>Sign in</button></form></body></html>`;
  return new Response(html, { status: failed ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function guard(request: Request, password: string | undefined): Promise<Response | null> {
  const url = new URL(request.url);
  const api = url.pathname.startsWith("/api/") || url.pathname.startsWith("/agents/");
  if (!password) return Response.json({ error: "chef needs the CHEF_PASSWORD secret before it serves anyone" }, { status: 503 });
  const token = await sessionToken(password);
  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    if (!same(String(form.get("password") ?? ""), password)) return loginPage(true);
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` } });
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (same(cookie(request, COOKIE) ?? "", token) || (bearer && same(bearer, password))) return null;
  return api ? Response.json({ error: "sign in first" }, { status: 401 }) : loginPage(false);
}
