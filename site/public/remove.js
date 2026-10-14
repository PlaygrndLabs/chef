const $ = (id) => document.getElementById(id);
const views = ["loading", "not-owner", "nothing", "confirm", "removing"];
const show = (name) => views.forEach((view) => ($(view).hidden = view !== name));
let plan = null;
let polling = null;

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

const code = (text) => el("code", { textContent: text });
const item = (...children) => el("li", {}, el("span", {}, ...children));

function renderConfirm() {
  const { org, engine, projects } = plan;
  const personal = org.personal;
  $("confirm-label").textContent = personal ? "Uninstall chef" : "Delete organization";
  $("confirm-title").textContent = personal ? "Uninstall chef from Personal" : `Delete ${org.name}`;
  $("confirm-sub").textContent = engine
    ? `This removes chef and everything it made for ${personal ? "you" : org.name} from your Cloudflare account${personal ? "" : ", then deletes the organization"}. It can't be undone.`
    : `chef was never set up for ${org.name}, so nothing on Cloudflare needs removing. This deletes the organization from chef. It can't be undone.`;
  const goes = [];
  if (engine) {
    goes.push(item("chef's engine ", code(engine.name), " and its sandboxes"));
    if (projects === null) goes.push(item("Every project, with its live app and previews"));
    else if (projects.length === 0) goes.push(item("No projects yet"));
    else goes.push(item(projects.length === 1 ? "1 project with its live app and previews: " : `${projects.length} projects with their live apps and previews: `, el("span", { className: "sub-list" }, projects.join(", "))));
    goes.push(item("Their repos, chef's memory, the previews token and the sandbox image"));
  }
  if (!personal) goes.push(item("The organization: its members, invitations, project sharing and budgets"));
  $("goes").replaceChildren(...goes);
  const stays = [];
  if (engine) stays.push(item("Everything else on Cloudflare account ", code(engine.accountId), ", including chef for other organizations"));
  stays.push(item(personal ? "Personal and your account, ready to set chef up again" : "Everyone's own account and Personal workspace"));
  $("stays").replaceChildren(...stays);
  $("sign-in").hidden = !engine || plan.signedIn;
  if (engine) $("sign-in-account").textContent = engine.accountId;
  $("type-label").textContent = `Type ${org.name} to confirm`;
  $("go").textContent = personal ? "Uninstall chef" : "Delete organization";
  refresh();
  show("confirm");
}

function ready() {
  return plan && $("typed").value.trim() === plan.org.name && (!plan.engine || plan.signedIn);
}

function refresh() {
  $("go").disabled = !ready();
  $("form-error").textContent = "";
}

function renderRemoval(removal) {
  show("removing");
  const personal = removal.personal;
  $("org-step").textContent = personal ? "Reset Personal" : "Delete the organization";
  for (const li of document.querySelectorAll("#steps li")) li.dataset.state = removal.steps?.[li.dataset.step] ?? "waiting";
  const log = $("log");
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  log.textContent = (removal.log ?? []).join("\n");
  if (atBottom) log.scrollTop = log.scrollHeight;
  $("removing-label").textContent = personal ? "Uninstall chef" : "Delete organization";
  $("removing-title").textContent = personal ? "Uninstalling chef" : `Deleting ${removal.orgName}`;
  $("remove-error").textContent = removal.status === "failed" ? removal.error ?? "chef stopped" : "";
  const left = removal.left ?? [];
  $("left").hidden = left.length === 0;
  $("left-list").replaceChildren(...left.map((what) => item(what)));
  if (removal.status === "done") {
    $("removing-title").textContent = personal ? "chef is uninstalled" : `${removal.orgName} is deleted`;
    $("removing-sub").textContent = removal.accountId
      ? `Everything chef made${personal ? "" : ` for ${removal.orgName}`} on your Cloudflare account is gone, and chef handed back its access to the account.${personal ? " Personal is ready whenever you want to set chef up again." : ""}`
      : `${removal.orgName} is no longer in chef.`;
    $("finish").hidden = false;
  }
  if (removal.status === "failed") {
    $("removing-title").textContent = "Removal stopped";
    $("removing-sub").textContent = "Nothing outside this organization's chef was touched. Sign in again to pick up where chef stopped.";
    $("retry").hidden = false;
  }
  if (removal.status !== "running" && polling) {
    clearInterval(polling);
    polling = null;
  }
}

async function poll() {
  const response = await fetch("/site/api/remove", { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return;
  const body = await response.json();
  if (body.removal) renderRemoval(body.removal);
}

async function load() {
  const response = await fetch("/site/api/remove", { cache: "no-store" }).catch(() => null);
  if (response?.status === 401) return location.assign("/");
  if (!response?.ok) {
    $("loading").textContent = "Could not load this page. Check your connection and reload.";
    return;
  }
  plan = await response.json();
  const removal = plan.removal;
  if (removal && (removal.status !== "failed" || removal.orgId === plan.org?.id)) {
    renderRemoval(removal);
    if (removal.status === "running") polling = setInterval(poll, 2000);
    return;
  }
  if (!plan.allowed) {
    $("not-owner-sub").textContent = `Only owners of ${plan.org?.name ?? "this organization"} can delete it or uninstall chef. Ask an owner if it should go.`;
    return show("not-owner");
  }
  if (plan.org.personal && !plan.engine) return show("nothing");
  renderConfirm();
}

$("typed").addEventListener("input", refresh);

$("confirm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ready()) return;
  $("go").disabled = true;
  const response = await fetch("/site/api/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: $("typed").value.trim() }) }).catch(() => null);
  const body = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) {
    $("go").disabled = false;
    $("form-error").textContent = body.error ?? "Could not start. Check your connection and try again.";
    return;
  }
  renderRemoval(body);
  if (body.status === "running") polling = setInterval(poll, 2000);
});

$("finish").addEventListener("click", async () => {
  await fetch("/site/api/remove", { cache: "no-store" }).catch(() => null);
  await fetch("/site/api/remove", { method: "DELETE" }).catch(() => null);
  location.assign("/");
});

$("toggle-log").addEventListener("click", () => {
  $("log").hidden = !$("log").hidden;
  $("toggle-log").textContent = $("log").hidden ? "Show log" : "Hide log";
});

load();
