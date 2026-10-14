const $ = (id) => document.getElementById(id);

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const badge = (text, kind) => el("span", { className: `badge ${kind ?? ""}`, textContent: text });
const label = (text) => el("p", { className: "label", textContent: text });
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const day = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");
const money = (micros) => (micros === null || micros === undefined ? "—" : `$${(micros / 1_000_000).toFixed(2)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const SETUP = { done: ["Ready", "ok"], running: ["Setting up", "run"], failed: ["Failed", "warn"], idle: ["Not set up", ""] };
const ROLES = ["owner", "admin", "member"];

function showError(text) {
  $("error").textContent = text ?? "";
  $("error").hidden = !text;
}

async function call(path, init = {}) {
  const response = await fetch(path, { ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } }).catch(() => null);
  if (response?.status === 401) {
    location.assign("/auth/start");
    return null;
  }
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) {
    showError(body?.error ?? "The backoffice could not reach chef. Refresh to try again.");
    return null;
  }
  showError(null);
  return body;
}

function stat(name, value, href) {
  const inner = [el("strong", { textContent: String(value) }), el("span", { className: "label", textContent: name })];
  return href ? el("a", { className: "stat", href }, inner) : el("div", { className: "stat" }, inner);
}

function table(headers, rows, emptyText) {
  return el(
    "div",
    { className: "table" },
    el(
      "table",
      {},
      el("thead", {}, el("tr", {}, headers.map((h) => el("th", { textContent: h })))),
      el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colSpan: headers.length, className: "muted", textContent: emptyText }))),
    ),
  );
}

function linkRow(href, cells) {
  const row = el("tr", { className: "linked", tabIndex: 0 }, cells);
  const go = () => (location.hash = href);
  row.addEventListener("click", (event) => {
    if (!event.target.closest("a, button, input, select")) go();
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") go();
  });
  return row;
}

function setupCell(org) {
  const [text, kind] = SETUP[org.install] ?? SETUP.idle;
  return el("td", {}, badge(text, kind), org.error ? el("div", { className: "error small", textContent: org.error }) : null);
}

function engineCell(org, latest) {
  if (!org.engine) return el("td", { className: "muted", textContent: "None" });
  const behind = latest && org.version && org.version !== latest;
  return el(
    "td",
    {},
    el("div", { className: "mono", textContent: new URL(org.engine).host.split(".")[0] }),
    org.version ? el("div", { className: "muted small" }, `Version ${org.version}`, behind ? badge("behind", "warn") : null) : null,
  );
}

function orgRows(orgs, latest) {
  return orgs.map((org) =>
    linkRow(`#/orgs/${org.id}`, [
      el("td", {}, el("div", {}, el("a", { href: `#/orgs/${org.id}`, textContent: org.name }), org.personal ? badge("personal") : null), el("div", { className: "muted small", textContent: `${org.owner ?? "No owner"} · ${plural(org.members, "member")}` })),
      engineCell(org, latest),
      setupCell(org),
      el("td", { className: "nowrap", textContent: day(org.createdAt) }),
    ]),
  );
}

function userRows(users) {
  return users.map((user) =>
    linkRow(`#/people/${user.id}`, [
      el("td", {}, el("a", { href: `#/people/${user.id}`, textContent: user.email ?? user.id }), user.admin ? badge("admin", "ok") : null),
      el("td", { textContent: String(user.orgs) }),
      el("td", { className: "nowrap", textContent: day(user.firstSeen) }),
      el("td", { className: "nowrap", textContent: when(user.lastSeen) }),
    ]),
  );
}

function searchBox(placeholder, onInput) {
  const input = el("input", { type: "search", placeholder, className: "search", ariaLabel: placeholder });
  input.addEventListener("input", () => onInput(input.value.trim().toLowerCase()));
  return input;
}

function heading(title, sub, ...extra) {
  return el("header", { className: "head" }, el("div", {}, el("h1", { textContent: title }), sub ? el("p", { className: "muted", textContent: sub }) : null), extra);
}

async function overview() {
  const data = await call("/api/directory");
  if (!data) return [];
  const { users, orgs, latest } = data;
  const engines = orgs.filter((o) => o.engine);
  const behind = engines.filter((o) => latest && o.version && o.version !== latest);
  const attention = orgs.filter((o) => o.install === "failed" || o.install === "running" || (latest && o.engine && o.version && o.version !== latest));
  return [
    heading("Overview", latest ? `Latest chef version ${latest}` : "Every organization and person on chef"),
    el(
      "div",
      { className: "stats" },
      stat("People", users.length, "#/people"),
      stat("Organizations", orgs.length, "#/orgs"),
      stat("Running chef", engines.length, "#/orgs"),
      stat("Behind latest", behind.length),
      stat("Setting up", orgs.filter((o) => o.install === "running").length),
      stat("Failed setups", orgs.filter((o) => o.install === "failed").length),
    ),
    label("Needs attention"),
    table(["Organization", "chef", "Setup", "Created"], orgRows(attention, latest), "Nothing needs attention."),
    label("Recent sign-ins"),
    table(["Person", "Organizations", "Joined", "Last sign-in"], userRows(users.slice(0, 8)), "No one has signed in yet."),
  ];
}

async function orgList() {
  const data = await call("/api/directory");
  if (!data) return [];
  const body = el("tbody");
  const render = (q) => body.replaceChildren(...orgRows(data.orgs.filter((o) => !q || `${o.name} ${o.owner ?? ""} ${o.engine ?? ""} ${o.accountId ?? ""}`.toLowerCase().includes(q)), data.latest));
  render("");
  return [
    heading("Organizations", `${plural(data.orgs.length, "organization")}, ${data.orgs.filter((o) => o.engine).length} with chef running`, searchBox("Search organizations", render)),
    el("div", { className: "table" }, el("table", {}, el("thead", {}, el("tr", {}, ["Organization", "chef", "Setup", "Created"].map((h) => el("th", { textContent: h })))), body)),
  ];
}

async function peopleList() {
  const data = await call("/api/directory");
  if (!data) return [];
  const body = el("tbody");
  const render = (q) => body.replaceChildren(...userRows(data.users.filter((u) => !q || `${u.email ?? ""} ${u.id}`.toLowerCase().includes(q))));
  render("");
  return [
    heading("People", `${data.users.length} ${data.users.length === 1 ? "person" : "people"} signed in with Cloudflare`, searchBox("Search people", render)),
    el("div", { className: "table" }, el("table", {}, el("thead", {}, el("tr", {}, ["Person", "Organizations", "Joined", "Last sign-in"].map((h) => el("th", { textContent: h })))), body)),
  ];
}

function facts(pairs) {
  return el("dl", { className: "facts" }, pairs.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [el("dt", { className: "label", textContent: k }), el("dd", {}, v)]));
}

function form(fields, submitText, onSubmit) {
  const button = el("button", { type: "submit", className: "button", textContent: submitText });
  const node = el("form", { className: "inline" }, fields, button);
  node.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    await onSubmit();
    button.disabled = false;
  });
  return node;
}

async function act(path, init, orgId) {
  const next = await call(path, init);
  if (next) mount(orgDetailView(next, orgId));
}

function orgDetailView(d, orgId) {
  const base = `/api/orgs/${orgId}`;
  const { org, engine, spend, latest } = d;
  const [setupText, setupKind] = SETUP[org.install] ?? SETUP.idle;
  const nodes = [
    el("p", { className: "crumbs" }, el("a", { href: "#/orgs", textContent: "Organizations" })),
    heading(org.name, `${org.personal ? "Personal workspace" : "Organization"} · created ${day(org.createdAt)}`, el("div", { className: "badges" }, org.personal ? badge("personal") : null, badge(setupText, setupKind), d.removing ? badge("being removed", "warn") : null)),
    org.error ? el("p", { className: "error", textContent: org.error }) : null,
  ];

  nodes.push(label("chef"));
  nodes.push(
    engine
      ? el(
          "div",
          { className: "panel" },
          facts([
            ["Worker", el("span", { className: "mono", textContent: engine.name })],
            ["Address", el("span", { className: "mono", textContent: engine.host })],
            ["Cloudflare account", el("span", { className: "mono", textContent: engine.accountId })],
            ["Version", el("span", {}, engine.version, latest && engine.version !== latest ? badge(`latest ${latest}, updates on next sign-in`, "warn") : badge("latest", "ok"))],
            ["Previews", engine.previews ? "On" : "Off until the next update"],
            ["Answering", d.reachable ? badge("yes", "ok") : badge("no answer", "warn")],
          ]),
        )
      : el("div", { className: "panel muted", textContent: org.accountId ? `Not running. Last setup was on Cloudflare account ${org.accountId}.` : "chef is not set up for this organization." }),
  );

  if (engine) {
    const amount = el("input", { type: "number", min: "0", max: "1000000", step: "1", placeholder: "No limit", className: "money", ariaLabel: "Monthly budget in dollars", value: spend?.cap === null || spend?.cap === undefined ? "" : String(spend.cap / 1_000_000) });
    nodes.push(label(`Spend in ${spend ? new Date(`${spend.month}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "this month"}`));
    nodes.push(
      el(
        "div",
        { className: "panel split" },
        el("div", {}, el("strong", { className: "big", textContent: spend ? money(spend.spent) : "—" }), el("span", { className: "muted small", textContent: spend ? (spend.cap === null ? " of no limit" : ` of ${money(spend.cap)}`) : " chef did not answer" })),
        form([el("span", { className: "muted small", textContent: "Monthly budget $" }), amount], "Save budget", () =>
          act(`${base}/budget`, { method: "PUT", body: JSON.stringify({ dollars: amount.value === "" ? null : Number(amount.value) }) }, orgId),
        ),
      ),
    );
  }

  nodes.push(label(`People · ${d.members.length}`));
  nodes.push(
    table(
      ["Person", "Role", "Spent this month", "Joined", ""],
      d.members.map((m) => {
        const role = el("select", { ariaLabel: `Role of ${m.email ?? m.userId}`, disabled: org.personal }, ROLES.map((r) => el("option", { value: r, textContent: r, selected: r === m.role })));
        role.addEventListener("change", () => act(`${base}/members/${m.userId}`, { method: "PATCH", body: JSON.stringify({ role: role.value }) }, orgId));
        const remove = org.personal ? null : el("button", { type: "button", className: "link danger small", textContent: "Remove" });
        remove?.addEventListener("click", () => {
          if (confirm(`Remove ${m.email ?? m.userId} from ${org.name}?`)) act(`${base}/members/${m.userId}`, { method: "DELETE" }, orgId);
        });
        return el("tr", {}, el("td", {}, el("a", { href: `#/people/${m.userId}`, textContent: m.email ?? m.userId })), el("td", {}, role), el("td", { textContent: money(m.spent) }), el("td", { className: "nowrap", textContent: day(m.joinedAt) }), el("td", { className: "end" }, remove));
      }),
      "No members.",
    ),
  );

  if (d.invites.length) {
    nodes.push(label(`Invitations · ${d.invites.length}`));
    nodes.push(
      table(
        ["Email", "Role", "Invited", ""],
        d.invites.map((i) => {
          const cancel = el("button", { type: "button", className: "link danger small", textContent: "Cancel" });
          cancel.addEventListener("click", () => act(`${base}/invites/${encodeURIComponent(i.email)}`, { method: "DELETE" }, orgId));
          return el("tr", {}, el("td", { textContent: i.email }), el("td", { textContent: i.role }), el("td", { className: "nowrap", textContent: day(i.createdAt) }), el("td", { className: "end" }, cancel));
        }),
        "",
      ),
    );
  }

  if (engine) {
    nodes.push(label(d.projects ? `Projects · ${d.projects.length}` : "Projects"));
    nodes.push(
      d.projects
        ? table(["Project", "Spent this month", "Budget"], d.projects.map((p) => el("tr", {}, el("td", { className: "mono", textContent: p.name }), el("td", { textContent: money(p.spent) }), el("td", { textContent: p.cap === null ? "No limit" : money(p.cap) }))), "No projects yet.")
        : el("div", { className: "panel muted", textContent: "chef did not answer, so its projects are not listed." }),
    );
  }

  if (!org.personal) {
    const name = el("input", { type: "text", value: org.name, maxLength: 60, required: true, ariaLabel: "Organization name" });
    nodes.push(label("Rename"));
    nodes.push(el("div", { className: "panel" }, form([name], "Rename", () => act(base, { method: "PATCH", body: JSON.stringify({ name: name.value }) }, orgId))));
  }

  nodes.push(el("p", { className: "muted small id", textContent: org.id }));
  return nodes;
}

async function orgDetail(orgId) {
  const d = await call(`/api/orgs/${orgId}`);
  return d ? orgDetailView(d, orgId) : [el("p", { className: "crumbs" }, el("a", { href: "#/orgs", textContent: "Organizations" }))];
}

function progress(title, status) {
  return [label(title), el("div", { className: "panel" }, facts([["Status", status.status], ["Organization", status.orgName ?? status.orgId], ["Error", status.error]]), status.log?.length ? el("pre", { className: "log", textContent: status.log.slice(-40).join("\n") }) : null)];
}

async function personDetail(userId) {
  const d = await call(`/api/people/${userId}`);
  const crumbs = el("p", { className: "crumbs" }, el("a", { href: "#/people", textContent: "People" }));
  if (!d) return [crumbs];
  const { user } = d;
  return [
    crumbs,
    heading(user.email ?? user.id, `Joined ${day(user.firstSeen)} · last signed in ${when(user.lastSeen)}`, el("div", { className: "badges" }, user.admin ? badge("admin", "ok") : null)),
    label(`Organizations · ${d.orgs.length}`),
    table(
      ["Organization", "Role", "chef"],
      d.orgs.map((o) => linkRow(`#/orgs/${o.id}`, [el("td", {}, el("a", { href: `#/orgs/${o.id}`, textContent: o.name }), o.personal ? badge("personal") : null), el("td", { textContent: o.role }), el("td", { className: o.engine ? "mono" : "muted", textContent: o.engine ? new URL(o.engine).host.split(".")[0] : "None" })])),
      "No organizations.",
    ),
    d.install ? progress("Setup", d.install) : null,
    d.removal ? progress("Removal", d.removal) : null,
    el("p", { className: "muted small id", textContent: user.id }),
  ];
}

let route = 0;

function mount(nodes) {
  $("view").replaceChildren(...nodes.filter(Boolean));
}

async function render() {
  const mine = ++route;
  const hash = location.hash.replace(/^#/, "") || "/";
  const org = /^\/orgs\/(org_[A-Za-z0-9]{20})$/.exec(hash)?.[1];
  const person = /^\/people\/(usr_[A-Za-z0-9]{20})$/.exec(hash)?.[1];
  const section = hash.startsWith("/orgs") ? "orgs" : hash.startsWith("/people") ? "people" : "overview";
  for (const link of document.querySelectorAll("[data-nav]")) link.classList.toggle("active", link.dataset.nav === section);
  $("view").setAttribute("aria-busy", "true");
  const nodes = org ? await orgDetail(org) : person ? await personDetail(person) : hash === "/orgs" ? await orgList() : hash === "/people" ? await peopleList() : await overview();
  if (mine !== route) return;
  $("view").removeAttribute("aria-busy");
  mount(nodes);
  window.scrollTo(0, 0);
}

$("signout").addEventListener("click", async () => {
  const body = await call("/auth/signout", { method: "POST" });
  location.assign(body?.site ?? "/");
});

call("/api/me").then((me) => {
  if (me) $("me").textContent = me.email ?? "Signed in";
});

window.addEventListener("hashchange", render);
render();
