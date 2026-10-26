export type AppAnswer = { readonly status: "ready"; readonly url: string; readonly commitId: string } | { readonly status: "starting"; readonly since: number } | { readonly status: "failed"; readonly error: string } | { readonly status: "no-stack" } | { readonly status: "missing" };

const TEXT = {
  starting: { title: "Starting this app", detail: "Chef is starting this branch's app in its sandbox from the latest commit. The page opens by itself when it is ready." },
  failed: { title: "This app could not start", detail: "" },
  "no-stack": { title: "This branch has no app to run", detail: "Chef runs a Cloudflare Workers project with wrangler dev when it has a wrangler config at the root of the code, and any other stack from a compose file (compose.yaml or docker-compose.yml). This branch has neither. Ask Chef to add one." },
  missing: { title: "No app here", detail: "This branch has no commit yet, or it is gone." },
  down: { title: "This app is not answering", detail: "" },
} as const;

export function appPage(input: { readonly status: "starting" | "failed" | "no-stack" | "missing" | "down"; readonly target: string; readonly error?: string; readonly html?: boolean; readonly since?: number; readonly poll?: "state" | "self"; readonly path?: string }): Response {
  const code = input.status === "missing" ? 404 : input.status === "down" ? 502 : 200;
  if (input.html === false) return Response.json({ error: TEXT[input.status].title, status: input.status, ...(input.error ? { detail: input.error } : {}), ...(input.status === "starting" && input.since !== undefined ? { since: input.since } : {}) }, { status: code === 200 ? 503 : code, headers: { "cache-control": "no-store", ...(input.status === "starting" ? { "retry-after": "4" } : {}) } });
  const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  if (input.status === "starting") return startingPage({ target: escape(input.target), since: input.since ?? Date.now(), poll: input.poll ?? "self", path: escape(input.path || "/") });
  const { title } = TEXT[input.status];
  const detail = input.status === "failed" ? `Chef tried to start it and got this error:<pre>${escape(input.error ?? "")}</pre><a href="?retry=1">Try again</a>` : input.status === "down" ? `Its sandbox is running, but the app gave no answer:<pre>${escape(input.error ?? "")}</pre>Chef tries again every few seconds.` : TEXT[input.status].detail;
  const refresh = input.status === "down" ? '<meta http-equiv="refresh" content="6">' : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}<title>${title}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fafafa;color:#18181b}main{max-width:32rem;padding:24px}h1{font-size:18px}pre{white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:0;font-size:12px}@media (prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}pre{background:#27272a}}</style></head><body><main><h1>${title}</h1><p>${detail}</p><p><small>${escape(input.target)}</small></p></main></body></html>`;
  return new Response(html, { status: code, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const STARTING_STYLE = `:root{color-scheme:light dark;--bg:#fafafa;--fg:#18181b;--muted:#71717a;--line:#e4e4e7;--bar:#004dfc;--ok:#16a34a;--bad:#dc2626}@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--muted:#a1a1aa;--line:#27272a;--bar:#4d7dff;--ok:#4ade80;--bad:#f87171}}*{box-sizing:border-box}body{font:14px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:var(--bg);color:var(--fg)}main{width:100%;max-width:24rem;padding:24px;display:grid;gap:16px}.top{display:flex;justify-content:space-between;font:11px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.track{height:4px;background:var(--line);margin-top:8px}.fill{height:100%;width:0;background:var(--bar);transition:width .4s}h1{font-size:15px;font-weight:500;margin:0}p{margin:2px 0 0;font-size:12px;color:var(--muted)}ol{list-style:none;margin:0;padding:0;display:grid;gap:8px}li{display:flex;align-items:center;gap:10px;font-size:14px}li span{margin-left:auto;font:12px ui-monospace,monospace;color:var(--muted)}i{width:14px;height:14px;flex:none;border-radius:50%;border:1.5px solid var(--line)}li[data-state=done] i{border-color:var(--ok);background:var(--ok)}li[data-state=run] i{border-color:var(--bar);border-right-color:transparent;animation:spin .8s linear infinite}li[data-state=wait]{color:var(--muted)}li[data-state=wait] i{width:6px;height:6px;margin:4px;background:var(--line);border:0}small{color:var(--muted);font:12px ui-monospace,monospace}@keyframes spin{to{transform:rotate(360deg)}}`;

const STARTING_SCRIPT = `const S=document.currentScript.dataset,since=Number(S.since),poll=S.poll,typical=45000,slowMs=90000;let ready=null;const $=(id)=>document.getElementById(id);
const sec=(ms)=>(Math.max(0,ms)/1000).toFixed(1)+" s";
function render(){const now=Date.now(),ms=(ready??now)-since,fill=1-Math.exp(-Math.max(0,ms)/typical),pct=ready?96:Math.min(94,Math.round(6+82*0.92*fill));$("pct").textContent=pct+"%";$("fill").style.width=pct+"%";$("start").dataset.state=ready?"done":"run";$("start-took").textContent=sec(ms);$("open").dataset.state=ready?"run":"wait";$("open-took").textContent=ready?sec(now-ready):"";if(ready){$("title").textContent="Opening the app";$("detail").textContent="The app is running. Opening its page.";}else if(ms>=slowMs)$("detail").textContent="Chef is starting this app in its sandbox from the latest commit. This is taking longer than usual; the page opens by itself when it is ready."}
function clean(){const u=new URL(location.href);u.searchParams.delete("retry");u.searchParams.delete("state");return u}
async function check(){try{if(poll==="state"){const u=clean();u.searchParams.set("state","1");const s=await (await fetch(u,{cache:"no-store"})).json();if(s.status==="ready"){ready=Date.now();render();location.replace(s.enter||clean().toString());return}if(s.status!=="starting"){location.replace(clean().toString());return}}else{const r=await fetch(location.href,{cache:"no-store",redirect:"manual",headers:{accept:"application/json"}});const s=r.status===503?await r.json().catch(()=>null):null;if(!s||s.status!=="starting"){ready=Date.now();render();location.reload();return}}}catch{}setTimeout(check,1500)}
render();setInterval(()=>{if(!ready)render()},200);setTimeout(check,1000);`;

function startingPage(input: { readonly target: string; readonly since: number; readonly poll: "state" | "self"; readonly path: string }): Response {
  const step = (id: string, label: string, state: string) => `<li id="${id}" data-state="${state}"><i></i>${label}<span id="${id}-took"></span></li>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><noscript><meta http-equiv="refresh" content="4"></noscript><title>Starting this app</title><style>${STARTING_STYLE}</style></head><body><main role="status" aria-live="polite" data-app-load="start"><div><div class="top"><span>Loading</span><span id="pct">6%</span></div><div class="track"><div class="fill" id="fill"></div></div></div><div><h1 id="title">Starting the app</h1><p id="detail">Chef is starting this app in its sandbox from the latest commit. The page opens by itself when it is ready.</p></div><ol>${step("check", "Check the app", "done")}${step("start", "Start the app from the latest commit", "run")}${step("open", `Open ${input.path}`, "wait")}</ol><small>${input.target}</small></main><script data-since="${input.since}" data-poll="${input.poll}">${STARTING_SCRIPT}</script></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function appPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\s\\]/.test(raw)) return "";
  return raw.slice(0, 300);
}

export function appResponse(state: AppAnswer, input: { readonly target: string; readonly path: string; readonly asState: boolean; readonly now: number; readonly enter?: string }): Response {
  if (input.asState) return Response.json(state.status === "starting" ? { ...state, elapsedMs: Math.max(0, input.now - state.since) } : state.status === "ready" && input.enter ? { ...state, enter: input.enter } : state, { headers: { "cache-control": "no-store" } });
  if (state.status === "ready") return new Response(null, { status: 302, headers: { location: input.enter ?? `${state.url.replace(/\/$/, "")}${input.path}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  return appPage({ status: state.status, target: input.target, path: input.path || "/", ...(state.status === "failed" ? { error: state.error } : {}), ...(state.status === "starting" ? { since: state.since, poll: "state" as const } : {}) });
}
