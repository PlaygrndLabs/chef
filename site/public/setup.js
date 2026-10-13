const $ = (id) => document.getElementById(id);
const views = ["loading", "signed-out", "choose", "installing"];
const show = (name) => views.forEach((view) => ($(view).hidden = view !== name));
let accounts = [];
let polling = null;

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
  const updating = Boolean(account?.chefUrl);
  $("password-fields").hidden = updating;
  $("go").textContent = updating ? "Update chef" : "Set up chef";
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
    if (account.chefUrl) meta.append("chef is already here. Choosing this account updates it and keeps your projects. ", el("a", { href: account.chefUrl, target: "_blank", rel: "noopener", textContent: "Open it" }));
    else if (account.plan === "free") meta.append("chef needs the Workers Paid plan on this account. ", el("a", { href: `https://dash.cloudflare.com/${account.id}/workers/plans`, target: "_blank", rel: "noopener", textContent: "Upgrade in Cloudflare" }), ", then come back here.");
    else meta.append(account.subdomain ? `chef will open at chef.${account.subdomain}.workers.dev` : "chef will create a workers.dev address for this account");
    const name = el("div", { className: "name" }, account.name, account.plan === "paid" ? badge("Workers Paid", "ok") : account.plan === "free" ? badge("Free plan", "warn") : null, account.chefUrl ? badge("chef installed", "ok") : null);
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
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  log.textContent = (install.log ?? []).join("\n");
  if (atBottom) log.scrollTop = log.scrollHeight;
  $("install-error").textContent = install.error ?? "";
  if (install.status === "done") {
    $("install-title").textContent = "chef is ready";
    $("install-sub").textContent = "Open your chef and sign in with the password you chose. Cloudflare access for this setup has been handed back.";
    $("open").href = install.url;
    $("open").hidden = false;
  }
  if (install.status === "failed") {
    $("install-title").textContent = "Setup stopped";
    $("install-sub").textContent = "Nothing needs cleaning up. Fix what the message says and try again.";
    $("retry").hidden = false;
    log.hidden = false;
    $("toggle-log").textContent = "Hide log";
  }
  if (install.status !== "running" && polling) {
    clearInterval(polling);
    polling = null;
    $("signout").hidden = true;
  }
}

async function poll() {
  const response = await fetch("/api/install", { cache: "no-store" }).catch(() => null);
  if (response?.ok) renderInstall(await response.json());
}

async function load() {
  const response = await fetch("/api/session", { cache: "no-store" }).catch(() => null);
  const session = response?.ok ? await response.json() : { signedIn: false };
  if (session.install) {
    renderInstall(session.install);
    if (session.install.status === "running") polling = setInterval(poll, 2000);
    return;
  }
  if (!session.signedIn) return show("signed-out");
  $("signout").hidden = false;
  accounts = session.accounts ?? [];
  renderAccounts();
  show("choose");
}

$("choose").addEventListener("submit", async (event) => {
  event.preventDefault();
  const account = selected();
  if (!account) return;
  const updating = Boolean(account.chefUrl);
  const password = $("password").value;
  if (!updating && password.length < 8) return ($("form-error").textContent = "Use a password of at least 8 characters.");
  if (!updating && password !== $("password2").value) return ($("form-error").textContent = "The two passwords do not match.");
  $("go").disabled = true;
  const response = await fetch("/api/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: account.id, password: updating ? null : password }) }).catch(() => null);
  const body = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) {
    $("go").disabled = false;
    $("form-error").textContent = body.error ?? "Could not start setup. Check your connection and try again.";
    return;
  }
  renderInstall(body);
  polling = setInterval(poll, 2000);
});

$("toggle-log").addEventListener("click", () => {
  $("log").hidden = !$("log").hidden;
  $("toggle-log").textContent = $("log").hidden ? "Show log" : "Hide log";
});

$("signout").addEventListener("click", async (event) => {
  event.preventDefault();
  await fetch("/api/signout", { method: "POST" }).catch(() => null);
  location.href = "/";
});

load();
