const scopes = [
  ["user", "User Details Read", "Tells chef who you are, so you can sign in."],
  ["card", "Account Settings Read", "Lists your accounts and checks they are on Workers Paid."],
  ["code", "Workers Scripts Write", "Installs chef in the account you pick."],
  ["code", "Workers Containers Write", "Adds the sandbox where chef builds your code."],
  ["code", "Cloudchamber Write", "Starts and stops those sandboxes."],
  ["globe", "Artifacts Write", "Creates a git repository for each project."],
  ["code", "Vectorize Write", "Stores what chef remembers about each project."],
  ["brain", "Workers AI Write", "Lets chef search that memory."],
];

const icons = {
  user: '<rect x="3" y="6" width="18" height="12"/><path d="M7 14h4M14 14h3"/>',
  card: '<rect x="3" y="6" width="18" height="12"/><path d="M14 14h3M7 14h1"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
  brain: '<path d="M12 6v12M9 6a3 3 0 0 0-3 3 3 3 0 0 0 0 6 3 3 0 0 0 3 3M15 6a3 3 0 0 1 3 3 3 3 0 0 1 0 6 3 3 0 0 1-3 3"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M12 9v4M12 16v.5"/>',
};
const icon = (name) => `<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[name]}</svg></span>`;

const dialog = document.createElement("dialog");
dialog.className = "signin";
dialog.setAttribute("aria-labelledby", "signin-title");
dialog.innerHTML = `
  <form method="dialog" class="signin-body">
    <p class="signin-kicker">Before you go</p>
    <h2 id="signin-title">Next, Cloudflare asks you to allow chef.</h2>
    <p class="signin-sub">We are sending you to Cloudflare to sign in. It will show the permissions below, and here is what each one is for. They are all on already except <b>one switch at the bottom, which you need to turn on.</b></p>
    <div class="cf-mock">
      <p class="cf-bar"><span>dash.cloudflare.com</span><span>Authorize chef</span></p>
      <div class="cf-head"><span>Permissions this app will be granted</span><span>Required</span></div>
      <ul class="cf-scopes">
        ${scopes.map(([kind, name, why]) => `<li><span class="chip">${icon(kind)}${name}</span><span class="leader" aria-hidden="true"></span><span class="why">${why}</span></li>`).join("")}
      </ul>
      <div class="cf-head"><span>Additional access</span></div>
      <div class="cf-sensitive">
        <p class="cf-group"><span class="ico warn" aria-hidden="true"><svg viewBox="0 0 24 24">${icons.shield}</svg></span>Sensitive scopes<span class="count">1 permission</span></p>
        <div class="cf-must">
          <div class="cf-toggle-row">
            <span><b>Account API Tokens Write</b><small>Grants write access to account API Tokens</small></span>
            <span class="switch" aria-hidden="true"><i></i></span>
          </div>
          <p class="why must"><span class="tag">Turn this on</span>Cloudflare leaves it off for every app. chef uses it once, to make a token that can only publish your previews and live apps. Without it, previews will not work.</p>
        </div>
      </div>
    </div>
    <p class="signin-fine">chef's access to your account ends as soon as setup is done.</p>
    <div class="signin-actions">
      <button class="btn btn-outline" value="cancel">Cancel</button>
      <a class="btn btn-cf" data-go href="/auth/start">Continue to Cloudflare <span aria-hidden="true">&rarr;</span></a>
    </div>
  </form>`;
document.body.append(dialog);

const go = dialog.querySelector("[data-go]");
const open = (href) => {
  go.href = href;
  dialog.classList.remove("on");
  dialog.showModal();
  requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("on")));
};
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

document.addEventListener("click", (event) => {
  const link = event.target.closest?.('a[href="/auth/start"]');
  if (!link || link === go || dialog.open || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (typeof dialog.showModal !== "function") return;
  event.preventDefault();
  open(link.getAttribute("href"));
});
