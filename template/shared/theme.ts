import type { ColorToken, Colors } from "./meta.ts";

export const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "check-circle": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-up": '<path d="m18 15-6-6-6 6"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  "external-link": '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  "more-horizontal": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  "list-checks": '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  tag: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  "map-pin": '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  "trending-up": '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  sparkles: '<path d="M12 3l1.9 5.8L19.7 10.7l-5.8 1.9L12 18.4l-1.9-5.8L4.3 10.7l5.8-1.9z"/><path d="M19 3v4"/><path d="M21 5h-4"/>',
} as const;

export type IconName = keyof typeof ICONS;

export const CSS = `:root{--bg:#fafafa;--fg:#09090b;--card:#fff;--muted:#71717a;--muted-bg:#f4f4f5;--border:#e4e4e7;--input:#d4d4d8;--ring:#a1a1aa;--primary:#18181b;--primary-fg:#fafafa;--accent:#4f46e5;--danger:#dc2626;--danger-bg:#fef2f2;--success:#16a34a;--success-bg:#f0fdf4;--warning:#d97706;--warning-bg:#fffbeb;--info:#2563eb;--info-bg:#eff6ff;--radius:.75rem;--shadow:0 1px 2px rgb(0 0 0/.04),0 1px 3px rgb(0 0 0/.06);--shadow-lg:0 10px 30px -10px rgb(0 0 0/.2);color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-scheme=light]){--bg:#09090b;--fg:#fafafa;--card:#111113;--muted:#a1a1aa;--muted-bg:#1f1f23;--border:#27272a;--input:#3f3f46;--ring:#71717a;--primary:#fafafa;--primary-fg:#18181b;--accent:#818cf8;--danger:#f87171;--danger-bg:#2a1215;--success:#4ade80;--success-bg:#0f2417;--warning:#fbbf24;--warning-bg:#2a2010;--info:#60a5fa;--info-bg:#0f1b2e;--shadow:0 1px 2px rgb(0 0 0/.3);--shadow-lg:0 10px 30px -10px rgb(0 0 0/.6);color-scheme:dark}}
:root[data-scheme=dark]{--bg:#09090b;--fg:#fafafa;--card:#111113;--muted:#a1a1aa;--muted-bg:#1f1f23;--border:#27272a;--input:#3f3f46;--ring:#71717a;--primary:#fafafa;--primary-fg:#18181b;--accent:#818cf8;--danger:#f87171;--danger-bg:#2a1215;--success:#4ade80;--success-bg:#0f2417;--warning:#fbbf24;--warning-bg:#2a2010;--info:#60a5fa;--info-bg:#0f1b2e;--shadow:0 1px 2px rgb(0 0 0/.3);--shadow-lg:0 10px 30px -10px rgb(0 0 0/.6);color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
.alert:empty,.error:empty{display:none}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:15px/1.55 var(--font-body,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
h1,h2,h3,h4{margin:0;line-height:1.2;letter-spacing:-.02em;font-weight:650}
h1,h2,.display{font-family:var(--font-display,inherit)}
h1{font-size:1.875rem}h2{font-size:1.25rem}h3{font-size:1.05rem}h4{font-size:.95rem}
p{margin:0}
a{color:inherit;text-underline-offset:3px;text-decoration-color:var(--ring)}
a:hover{text-decoration-color:currentColor}
code,kbd,pre{font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:.85em}
code{background:var(--muted-bg);padding:.1rem .35rem;border-radius:.35rem}
pre{background:var(--muted-bg);padding:1rem;border-radius:var(--radius);overflow:auto}
hr{border:0;border-top:1px solid var(--border);margin:1.5rem 0}
img{max-width:100%;display:block}
::selection{background:color-mix(in srgb,var(--accent) 25%,transparent)}
.container{width:100%;max-width:42rem;margin:0 auto;padding:3.5rem 1.25rem 5rem}
.container.narrow{max-width:28rem}.container.wide{max-width:64rem}.container.full{max-width:none}
.page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:2rem}
.page-header p{color:var(--muted);margin-top:.4rem}
.eyebrow{display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;font-weight:600;color:var(--accent);margin-bottom:.5rem}
.section{margin-top:2.5rem}.section>h2{margin-bottom:1rem}
.muted{color:var(--muted)}.small{font-size:.85rem}.tiny{font-size:.75rem}.strong{font-weight:600}.center{text-align:center}.mono{font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.done{text-decoration:line-through;color:var(--muted)}
.stack{display:flex;flex-direction:column;gap:1rem}.stack-sm{display:flex;flex-direction:column;gap:.5rem}.stack-lg{display:flex;flex-direction:column;gap:1.75rem}
.row{display:flex;align-items:center;gap:.75rem}.row-sm{display:flex;align-items:center;gap:.4rem}
.between{justify-content:space-between}.end{justify-content:flex-end}.wrap{flex-wrap:wrap}.grow{flex:1;min-width:0}.top{align-items:flex-start}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))}
.grid-2{display:grid;gap:1rem;grid-template-columns:repeat(2,minmax(0,1fr))}.grid-3{display:grid;gap:1rem;grid-template-columns:repeat(3,minmax(0,1fr))}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:1.25rem}
.card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem}
.card-header p{color:var(--muted);font-size:.875rem;margin-top:.25rem}
.card-footer{display:flex;justify-content:flex-end;gap:.5rem;margin:1.25rem -1.25rem -1.25rem;padding:.875rem 1.25rem;border-top:1px solid var(--border);background:color-mix(in srgb,var(--muted-bg) 50%,transparent);border-radius:0 0 var(--radius) var(--radius)}
a.card{display:block;text-decoration:none;transition:border-color .15s,box-shadow .15s,transform .15s}
a.card:hover{border-color:var(--ring);box-shadow:var(--shadow-lg);transform:translateY(-1px)}
.icon{width:1.1em;height:1.1em;flex:none;vertical-align:-.15em}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;height:2.5rem;padding:0 1rem;border-radius:calc(var(--radius) - .25rem);border:1px solid transparent;background:var(--primary);color:var(--primary-fg);font:inherit;font-size:.9rem;font-weight:550;line-height:1;white-space:nowrap;text-decoration:none;cursor:pointer;user-select:none;transition:background-color .15s,border-color .15s,color .15s,opacity .15s,box-shadow .15s}
.btn:hover{opacity:.88}
.btn:active{transform:translateY(.5px)}
.btn:disabled,.btn[aria-disabled=true]{opacity:.5;cursor:not-allowed;transform:none}
.btn .icon{width:1rem;height:1rem}
.btn-accent{background:var(--accent);color:#fff}
.btn-secondary{background:var(--muted-bg);color:var(--fg)}
.btn-outline{background:var(--card);border-color:var(--border);color:var(--fg);box-shadow:var(--shadow)}
.btn-ghost{background:transparent;color:var(--fg)}
.btn-secondary:hover,.btn-outline:hover,.btn-ghost:hover{opacity:1;background:color-mix(in srgb,var(--muted-bg) 70%,var(--fg) 6%)}
.btn-danger{background:var(--danger);color:#fff}
.btn-ghost.btn-danger{background:transparent;color:var(--danger)}
.btn-ghost.btn-danger:hover{background:var(--danger-bg)}
.btn-sm{height:2rem;padding:0 .75rem;font-size:.82rem;border-radius:calc(var(--radius) - .3rem)}
.btn-lg{height:2.875rem;padding:0 1.4rem;font-size:.95rem}
.btn-icon{width:2.5rem;padding:0}.btn-icon.btn-sm{width:2rem}
.btn-block{width:100%}
.input,.select,.textarea{display:block;width:100%;height:2.5rem;padding:0 .8rem;border:1px solid var(--input);border-radius:calc(var(--radius) - .25rem);background:var(--card);color:var(--fg);font:inherit;font-size:.92rem;transition:border-color .15s,box-shadow .15s}
.textarea{height:auto;min-height:6rem;padding:.6rem .8rem;resize:vertical;line-height:1.5}
.select{appearance:none;padding-right:2.2rem;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .7rem center;background-size:1rem}
.input::placeholder,.textarea::placeholder{color:var(--muted);opacity:.8}
.input[aria-invalid=true],.textarea[aria-invalid=true]{border-color:var(--danger)}
.btn:focus-visible,.input:focus-visible,.select:focus-visible,.textarea:focus-visible,a:focus-visible,input[type=checkbox]:focus-visible,[tabindex]:focus-visible{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in srgb,var(--ring) 40%,transparent)}
input[type=checkbox],input[type=radio]{width:1.1rem;height:1.1rem;margin:0;accent-color:var(--primary);cursor:pointer;flex:none}
.field{display:flex;flex-direction:column;gap:.4rem}
.label{font-size:.85rem;font-weight:550}
.hint{font-size:.8rem;color:var(--muted)}
.error{font-size:.8rem;color:var(--danger)}
.input-group{display:flex;gap:.5rem}.input-group .input{flex:1;min-width:0}
.search{position:relative}.search .icon{position:absolute;left:.8rem;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}.search .input{padding-left:2.4rem}
.list{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
.list>li,.list>.item{display:flex;align-items:center;gap:.75rem;min-height:3.25rem;padding:.6rem .75rem .6rem 1rem;border-top:1px solid var(--border);transition:background-color .12s}
.list>li:first-child,.list>.item:first-child{border-top:0}
.list>li:hover,.list>.item:hover{background:color-mix(in srgb,var(--muted-bg) 55%,transparent)}
.list .actions{display:flex;gap:.125rem;margin-left:auto}
.list .actions .btn{color:var(--muted)}.list .actions .btn:hover{color:var(--fg)}
.badge{display:inline-flex;align-items:center;gap:.3rem;height:1.375rem;padding:0 .55rem;border-radius:999px;font-size:.75rem;font-weight:550;white-space:nowrap;background:var(--muted-bg);color:var(--fg);border:1px solid transparent}
.badge .icon{width:.8rem;height:.8rem}
.badge-outline{background:transparent;border-color:var(--border)}
.badge-accent{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
.badge-success{background:var(--success-bg);color:var(--success)}.badge-warning{background:var(--warning-bg);color:var(--warning)}.badge-danger{background:var(--danger-bg);color:var(--danger)}.badge-info{background:var(--info-bg);color:var(--info)}
.dot{display:inline-block;width:.5rem;height:.5rem;border-radius:999px;background:currentColor}
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:.4rem;padding:3rem 1.5rem;border:1px dashed var(--border);border-radius:var(--radius);color:var(--muted);font-size:.9rem}
.empty>.icon{width:2.75rem;height:2.75rem;padding:.65rem;margin-bottom:.4rem;border-radius:999px;background:var(--muted-bg);color:var(--fg)}
.empty strong{color:var(--fg);font-size:1rem;font-weight:600}
.empty .btn{margin-top:.75rem}
.alert{display:flex;align-items:flex-start;gap:.65rem;padding:.8rem 1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);font-size:.9rem}
.alert>.icon{margin-top:.15rem}
.alert-danger{border-color:color-mix(in srgb,var(--danger) 35%,transparent);background:var(--danger-bg);color:var(--danger)}
.alert-success{border-color:color-mix(in srgb,var(--success) 35%,transparent);background:var(--success-bg);color:var(--success)}
.alert-warning{border-color:color-mix(in srgb,var(--warning) 35%,transparent);background:var(--warning-bg);color:var(--warning)}
.alert-info{border-color:color-mix(in srgb,var(--info) 35%,transparent);background:var(--info-bg);color:var(--info)}
.table-wrap{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto}
.table{width:100%;border-collapse:collapse;font-size:.9rem}
.table th{text-align:left;font-weight:550;font-size:.8rem;color:var(--muted);background:color-mix(in srgb,var(--muted-bg) 50%,transparent)}
.table th,.table td{padding:.7rem 1rem;border-bottom:1px solid var(--border);vertical-align:middle}
.table tr:last-child td{border-bottom:0}
.table tbody tr:hover{background:color-mix(in srgb,var(--muted-bg) 45%,transparent)}
.stat{display:flex;flex-direction:column;gap:.25rem}.stat .value{font-size:1.75rem;font-weight:650;letter-spacing:-.02em}.stat .label{color:var(--muted);font-weight:500}
.avatar{display:inline-flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;border-radius:999px;background:var(--muted-bg);font-size:.8rem;font-weight:600;flex:none;overflow:hidden}
.tabs{display:inline-flex;gap:.25rem;padding:.25rem;background:var(--muted-bg);border-radius:calc(var(--radius) - .1rem)}
.tabs>button,.tabs>a{display:inline-flex;align-items:center;gap:.4rem;height:2rem;padding:0 .8rem;border:0;border-radius:calc(var(--radius) - .3rem);background:transparent;color:var(--muted);font:inherit;font-size:.85rem;font-weight:550;text-decoration:none;cursor:pointer}
.tabs>[aria-selected=true],.tabs>[aria-pressed=true],.tabs>[aria-current=page],.tabs>.active{background:var(--card);color:var(--fg);box-shadow:var(--shadow)}
.progress{height:.5rem;border-radius:999px;background:var(--muted-bg);overflow:hidden}.progress>span{display:block;height:100%;background:var(--accent);border-radius:inherit;transition:width .3s}
.skeleton{background:var(--muted-bg);border-radius:.4rem;min-height:1rem;animation:ui-pulse 1.5s ease-in-out infinite}
.spin{animation:ui-spin 1s linear infinite}
dialog{border:1px solid var(--border);border-radius:calc(var(--radius) + .25rem);padding:1.5rem;width:calc(100% - 2rem);max-width:28rem;background:var(--card);color:var(--fg);box-shadow:var(--shadow-lg)}
dialog::backdrop{background:rgb(0 0 0/.45);backdrop-filter:blur(2px)}
dialog h2{margin-bottom:.5rem}
.topbar{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:saturate(1.5) blur(10px)}
.topbar>div{display:flex;align-items:center;gap:1rem;max-width:42rem;margin:0 auto;padding:.75rem 1.25rem}.topbar>.narrow{max-width:28rem}.topbar>.wide{max-width:64rem}.topbar>.full{max-width:none}
.topbar .brand{display:inline-flex;align-items:center;gap:.5rem;font-weight:650;text-decoration:none}
.topbar nav{display:flex;gap:.25rem;margin-left:auto}
.topbar nav a{padding:.35rem .7rem;border-radius:.5rem;color:var(--muted);font-size:.9rem;text-decoration:none}
.topbar nav a:hover,.topbar nav a[aria-current=page]{color:var(--fg);background:var(--muted-bg)}
.hero{padding:2rem 0 1rem;text-align:center}.hero h1{font-size:clamp(2rem,5vw,3rem)}.hero p{color:var(--muted);font-size:1.1rem;max-width:34rem;margin:.75rem auto 0}
.ui-toasts{position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.5rem;z-index:100;pointer-events:none}
.ui-toast{display:flex;align-items:center;gap:.5rem;padding:.65rem 1rem;border-radius:.65rem;background:var(--fg);color:var(--bg);font-size:.9rem;box-shadow:var(--shadow-lg);animation:ui-rise .2s ease-out}
.ui-toast.danger{background:var(--danger);color:#fff}
@keyframes ui-spin{to{transform:rotate(360deg)}}
@keyframes ui-pulse{50%{opacity:.5}}
@keyframes ui-rise{from{opacity:0;transform:translateY(.5rem)}}
@media (max-width:640px){.container{padding:2rem 1rem 4rem}h1{font-size:1.5rem}.grid-2,.grid-3{grid-template-columns:minmax(0,1fr)}.page-header{margin-bottom:1.5rem}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;

export const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|hsl|oklch)\([0-9.,%\s/a-z-]+\))$/;

const TOKENS: readonly ColorToken[] = ["bg", "fg", "card", "muted", "muted-bg", "border", "input", "ring", "primary", "primary-fg", "accent", "danger", "success", "warning", "info"];

function tokens(colors: Colors | undefined): string {
  return TOKENS.flatMap((token) => (colors?.[token] && COLOR.test(colors[token]) ? [`--${token}:${colors[token]}`] : [])).join(";");
}

export function lookCss(look: { readonly accent?: string; readonly scheme?: "light" | "dark"; readonly colors?: { readonly light?: Colors; readonly dark?: Colors }; readonly radius?: string; readonly style?: string }): string {
  const light = [look.accent && COLOR.test(look.accent) ? `--accent:${look.accent};--primary:${look.accent};--primary-fg:#fff` : "", tokens(look.colors?.light), look.radius && /^(0|[0-9.]+(rem|px|em))$/.test(look.radius) ? `--radius:${look.radius}` : ""].filter(Boolean).join(";");
  const dark = tokens(look.colors?.dark);
  return [light ? `:root{${light}}` : "", dark ? `@media (prefers-color-scheme:dark){:root:not([data-scheme=light]){${dark}}}\n:root[data-scheme=dark]{${dark}}` : "", look.style ?? ""].filter(Boolean).join("\n");
}
