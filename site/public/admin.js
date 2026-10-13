const $ = (id) => document.getElementById(id);

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

const badge = (text, kind) => el("span", { className: `badge ${kind ?? ""}`, textContent: text });
const when = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const SETUP = { done: ["Ready", "ok"], running: ["Setting up", ""], failed: ["Failed", "warn"], idle: ["Not set up", ""] };

function stat(label, value) {
  return el("div", { className: "stat" }, el("strong", { textContent: String(value) }), el("span", { className: "muted", textContent: label }));
}

function row(member, latest) {
  const who = el("td", {}, el("div", {}, member.email ?? member.id, member.admin ? badge("admin", "ok") : null), el("div", { className: "muted small", textContent: member.accountId ? `Account ${member.accountId}` : "No account chosen" }));
  const chef = el("td", {}, member.engine ? el("a", { href: member.engine, target: "_blank", rel: "noopener", textContent: new URL(member.engine).host }) : el("span", { className: "muted", textContent: "None" }));
  if (member.version) chef.append(el("div", { className: "muted small" }, `Version ${member.version}`, latest && member.version !== latest ? badge("update on next sign-in", "warn") : null));
  const [label, kind] = SETUP[member.install] ?? SETUP.idle;
  const setup = el("td", {}, badge(label, kind), member.error ? el("div", { className: "error small", textContent: member.error }) : null);
  return el("tr", {}, who, chef, setup, el("td", { textContent: when(member.firstSeen) }), el("td", { textContent: when(member.lastSeen) }));
}

async function load() {
  const response = await fetch("/site/api/admin/members", { headers: { accept: "application/json" } });
  if (response.status === 401 || response.status === 403) return location.replace("/");
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    $("error").textContent = body?.error ?? "Could not load members. Refresh to try again.";
    return;
  }
  const members = body.members;
  $("stats").replaceChildren(
    stat("members", members.length),
    stat("with chef", members.filter((m) => m.engine).length),
    stat("setting up", members.filter((m) => m.install === "running").length),
    stat("failed setups", members.filter((m) => m.install === "failed").length),
  );
  $("rows").replaceChildren(...(members.length ? members.map((m) => row(m, body.latest)) : [el("tr", {}, el("td", { colSpan: 5, className: "muted", textContent: "No one has signed in yet." }))]));
}

load();
