const $ = (id) => document.getElementById(id);
const views = ["loading", "signed-out", "ask-owner", "choose", "installing"];
const show = (name) => views.forEach((view) => ($(view).hidden = view !== name));
let accounts = [];
let polling = null;
let stick = true;

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

function renderInstall(install) {
  show("installing");
  for (const item of document.querySelectorAll("#steps li")) item.dataset.state = install.steps?.[item.dataset.step] ?? "waiting";
  const log = $("log");
  log.textContent = (install.log ?? []).join("\n");
  if (stick) log.scrollTop = log.scrollHeight;
  $("install-error").textContent = install.error ?? "";
  if (install.update) $("install-title").textContent = "Updating chef";
  if (install.status === "done") {
    $("install-title").textContent = "chef is ready";
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
  if (me.install) {
    renderInstall(me.install);
    if (me.install.status === "running") polling = setInterval(poll, 2000);
    return;
  }
  if (me.engine) return location.assign("/");
  if (me.org && !me.org.personal) $("choose-title").textContent = `Set up chef for ${me.org.name}`;
  if (me.org?.role === "member") {
    $("ask-owner-sub").textContent = `chef isn't set up for ${me.org.name} yet. Ask an owner or admin of the organization to set it up, then open chef again.`;
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
