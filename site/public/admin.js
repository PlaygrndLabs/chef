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

function orgRow(org, latest) {
  const who = el("td", {}, el("div", {}, org.name, org.personal ? badge("personal") : null), el("div", { className: "muted small", textContent: `${org.owner ?? "No owner"} · ${org.members} ${org.members === 1 ? "member" : "members"}` }));
  const chef = el("td", {}, org.engine ? el("span", { textContent: new URL(org.engine).host }) : el("span", { className: "muted", textContent: "None" }));
  if (org.accountId) chef.append(el("div", { className: "muted small", textContent: `Account ${org.accountId}` }));
  if (org.version) chef.append(el("div", { className: "muted small" }, `Version ${org.version}`, latest && org.version !== latest ? badge("update on next sign-in", "warn") : null));
  const [label, kind] = SETUP[org.install] ?? SETUP.idle;
  const setup = el("td", {}, badge(label, kind), org.error ? el("div", { className: "error small", textContent: org.error }) : null);
  return el("tr", {}, who, chef, setup, el("td", { textContent: when(org.createdAt) }));
}

function userRow(user) {
  const who = el("td", {}, el("div", {}, user.email ?? user.id, user.admin ? badge("admin", "ok") : null));
  return el("tr", {}, who, el("td", { textContent: String(user.orgs) }), el("td", { textContent: when(user.firstSeen) }), el("td", { textContent: when(user.lastSeen) }));
}

const empty = (text) => [el("tr", {}, el("td", { colSpan: 4, className: "muted", textContent: text }))];

async function load() {
  const response = await fetch("/site/api/admin/members", { headers: { accept: "application/json" } });
  if (response.status === 401 || response.status === 403) return location.replace("/");
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    $("error").textContent = body?.error ?? "Could not load members. Refresh to try again.";
    return;
  }
  const { orgs, users } = body;
  $("stats").replaceChildren(
    stat("people", users.length),
    stat("organizations", orgs.length),
    stat("with chef", orgs.filter((o) => o.engine).length),
    stat("setting up", orgs.filter((o) => o.install === "running").length),
    stat("failed setups", orgs.filter((o) => o.install === "failed").length),
  );
  $("orgs").replaceChildren(...(orgs.length ? orgs.map((o) => orgRow(o, body.latest)) : empty("No organizations yet.")));
  $("users").replaceChildren(...(users.length ? users.map(userRow) : empty("No one has signed in yet.")));
}

load();
