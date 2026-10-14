const $ = (id) => document.getElementById(id);
const views = ["loading", "signed-out", "ask-owner", "choose", "installing"];
const show = (name) => views.forEach((view) => ($(view).hidden = view !== name));
let accounts = [];
let polling = null;
let stick = true;
let org = null;
let canLeave = false;

const label = (o) => (o.personal ? "Personal" : o.name);

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

function badge(text, kind) {
  return el("span", { className: `badge ${kind}`, textContent: text });
}

function selected() {
  const input = document.querySelector('input[name="account"]:checked');
  return accounts.find((account) => account.id === input?.value) ?? null;
}

function refreshForm() {
  const account = selected();
  $("go").disabled = !account;
  $("form-error").textContent = "";
}

function renderAccounts() {
  const list = $("accounts");
  list.replaceChildren();
  if (accounts.length === 0) {
    list.append(el("p", { className: "muted", textContent: "No Cloudflare accounts were shared during sign-in. Sign in again and select an account on Cloudflare's consent page." }));
    return;
  }
  for (const account of accounts) {
    const meta = el("div", { className: "meta" });
    if (account.plan === "free") meta.append("chef needs the Workers Paid plan on this account. ", el("a", { href: `https://dash.cloudflare.com/${account.id}/workers/plans`, target: "_blank", rel: "noopener", textContent: "Upgrade in Cloudflare" }), ", then come back here.");
    else meta.append("chef will set up its own engine for this organization on this account, next to anything already there.");
    const name = el("div", { className: "name" }, account.name, account.plan === "paid" ? badge("Workers Paid", "ok") : account.plan === "free" ? badge("Free plan", "warn") : null);
    const input = el("input", { type: "radio", name: "account", value: account.id });
    input.addEventListener("change", refreshForm);
    list.append(el("label", { className: "account" }, input, el("div", {}, name, meta)));
  }
  if (accounts.length === 1) list.querySelector("input").checked = true;
  refreshForm();
}

async function switchTo(orgId, button) {
  button.disabled = true;
  $("switch-error").textContent = "";
  const response = await fetch("/site/api/orgs/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId }) }).catch(() => null);
  if (response?.ok) return location.assign("/");
  const body = response ? await response.json().catch(() => ({})) : {};
  button.disabled = false;
  $("switch-error").textContent = body.error ?? "Could not switch. Check your connection and try again.";
  $("org-menu").open = true;
}

function renderOrgs(orgs) {
  $("org-menu-name").textContent = label(org);
  $("org-list").replaceChildren(
    ...orgs.map((o) => {
      const current = o.id === org.id;
      const item = el(
        "button",
        { type: "button", className: "org-item", disabled: current, title: current ? "You are setting up this one" : `Open ${label(o)}` },
        el("span", { className: "org-check", textContent: current ? "✓" : "" }),
        el("span", { className: "org-name", textContent: label(o) }),
        el("span", { className: o.ready ? "org-state" : "org-state todo", textContent: o.ready ? "Ready" : "Not set up" }),
      );
      if (!current) item.addEventListener("click", () => switchTo(o.id, item));
      return item;
    }),
  );
  $("org-menu").hidden = false;
}

function renderLeave(orgs) {
  const name = label(org);
  const back = orgs.find((o) => o.ready && o.id !== org.id) ?? null;
  $("later-text").textContent = `Not now? ${name} stays in your organizations, marked Not set up, so you can finish setting it up any time.`;
  $("back").hidden = !back;
  if (back) {
    $("back").textContent = `Go back to ${label(back)}`;
    $("back").onclick = () => switchTo(back.id, $("back"));
  }
  $("later").hidden = false;
  const owner = !org.personal && org.role === "owner";
  $("delete-org").hidden = !owner;
  $("delete-text").textContent = `Don't need ${name}?`;
  $("delete-link").textContent = `Delete ${name}`;
  canLeave = true;
  $("leave").hidden = false;
}

function setKicker(text) {
  $("kicker").textContent = text;
  $("kicker").hidden = !text;
}

function renderInstall(install) {
  show("installing");
  if (org) setKicker(label(org));
  $("leave").hidden = !(canLeave && install.status === "failed");
  for (const item of document.querySelectorAll("#steps li")) item.dataset.state = install.steps?.[item.dataset.step] ?? "waiting";
  const log = $("log");
  log.textContent = (install.log ?? []).join("\n");
  if (stick) log.scrollTop = log.scrollHeight;
  $("install-error").textContent = install.error ?? "";
  if (org && !org.personal) $("install-title").textContent = `Setting up chef for ${org.name}`;
  if (install.update) $("install-title").textContent = "Updating chef";
  if (install.status === "done") {
    $("install-title").textContent = org && !org.personal ? `chef is ready for ${org.name}` : "chef is ready";
    $("install-sub").textContent = "Your chef engine is running in your Cloudflare account. Cloudflare access for this setup has been handed back.";
    $("open").hidden = false;
    if (install.steps?.token === "skipped") {
      $("install-sub").textContent = "chef is running, but previews need one more permission. Sign in again and, on Cloudflare's page, turn on Account API Tokens Write under Sensitive scopes.";
      $("retry").textContent = "Sign in again";
      $("retry").hidden = false;
      $("open").className = "btn btn-outline";
      $("open").before($("retry"));
    }
  }
  if (install.status === "failed") {
    $("install-title").textContent = "Setup stopped";
    $("install-sub").textContent = "Nothing needs cleaning up. Fix what the message says and try again.";
    $("retry").hidden = false;
    log.hidden = false;
    $("toggle-log").textContent = "Hide log";
    $("toggle-log").setAttribute("aria-expanded", "true");
  }
  if (install.status !== "running" && polling) {
    clearInterval(polling);
    polling = null;
  }
}

async function poll() {
  const response = await fetch("/site/api/install", { cache: "no-store" }).catch(() => null);
  if (response?.ok) renderInstall(await response.json());
}

async function load() {
  const response = await fetch("/site/api/me", { cache: "no-store" }).catch(() => null);
  if (response?.status === 401) return location.assign("/");
  const me = response?.ok ? await response.json() : { canSetUp: false };
  org = me.org ?? null;
  const orgs = me.orgs ?? [];
  if (org) {
    renderOrgs(orgs);
    if (!me.engine) renderLeave(orgs);
  }
  if (me.install) {
    renderInstall(me.install);
    if (me.install.status === "running") polling = setInterval(poll, 2000);
    return;
  }
  if (me.engine) return location.assign("/");
  if (org) setKicker(`${label(org)} · not set up yet`);
  if (org && !org.personal) {
    $("choose-title").textContent = $("signed-out-title").textContent = `Set up chef for ${org.name}`;
    $("choose-sub").textContent = `Choose the Cloudflare account ${org.name} runs on. Its projects, keys and previews stay there, and you use chef right here.`;
    $("signed-out-sub").textContent = `${org.name} is created. Next, sign in with Cloudflare and choose the Cloudflare account ${org.name} runs on. chef uses that access only while it sets up, then hands it back.`;
  }
  if (org?.role === "member") {
    $("ask-owner-sub").textContent = `chef isn't set up for ${org.name} yet. Ask an owner or admin of the organization to set it up, then open chef again.`;
    return show("ask-owner");
  }
  if (!me.canSetUp) return show("signed-out");
  accounts = me.accounts ?? [];
  renderAccounts();
  show("choose");
}

$("choose").addEventListener("submit", async (event) => {
  event.preventDefault();
  const account = selected();
  if (!account) return;
  $("go").disabled = true;
  const response = await fetch("/site/api/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: account.id }) }).catch(() => null);
  const body = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) {
    $("go").disabled = false;
    $("form-error").textContent = body.error ?? "Could not start setup. Check your connection and try again.";
    return;
  }
  renderInstall(body);
  polling = setInterval(poll, 2000);
});

document.addEventListener("click", (event) => {
  if (!$("org-menu").contains(event.target)) $("org-menu").open = false;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("org-menu").open = false;
});

$("open").addEventListener("click", async () => {
  await fetch("/site/api/install", { method: "DELETE" }).catch(() => null);
  location.assign("/");
});

$("log").addEventListener("scroll", () => {
  const log = $("log");
  stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
});

$("toggle-log").addEventListener("click", () => {
  const log = $("log");
  log.hidden = !log.hidden;
  $("toggle-log").textContent = log.hidden ? "Show log" : "Hide log";
  $("toggle-log").setAttribute("aria-expanded", String(!log.hidden));
  if (!log.hidden) {
    stick = true;
    log.scrollTop = log.scrollHeight;
  }
});

load();
