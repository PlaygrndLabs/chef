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
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M12 9v4M12 16v.5"/>',
};
const icon = (name) => `<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[name]}</svg></span>`;

const dialog = document.createElement("dialog");
dialog.className = "signin";
dialog.setAttribute("aria-labelledby", "signin-title-1");
dialog.innerHTML = `
  <form method="dialog" class="signin-body">
    <div class="signin-top">
      <p class="signin-kicker" data-count>Step 1 / 2</p>
      <span class="signin-steps" aria-hidden="true"><i class="done"></i><i></i></span>
      <button class="signin-close" value="cancel" aria-label="Close">&times;</button>
    </div>
    <div class="signin-step" data-step="1">
      <h2 id="signin-title-1">Here is what happens next.</h2>
      <dl class="signin-plan">
        <div><dt>Setup</dt><dd>We are going to install chef, or update it, in your Cloudflare account.</dd></div>
        <div><dt>Your access</dt><dd>We don't keep this permission. For full security, chef hands the access back as soon as setup is done. That's why Cloudflare asks you again each time you install or update chef, in any account.</dd></div>
        <div><dt>Plan</dt><dd>Your account needs the Workers Paid plan ($5/month). Don't worry, you can continue now and subscribe on Cloudflare afterwards. You only need it to finish setup and use chef.</dd></div>
      </dl>
    </div>
    <div class="signin-step" data-step="2" hidden>
      <h2 id="signin-title-2">Now we'll send you to Cloudflare.</h2>
      <p class="signin-sub">There you give chef control of your Cloudflare account with the permissions below. Here is why chef needs each one. They are all on already except <b>one switch at the bottom, which you need to turn on.</b></p>
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
            <p class="why must"><span class="tag">You must turn this on</span>Cloudflare leaves it off for every app. chef uses it once, to make a token that can only publish your previews and live apps. Without it, previews will not work.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="signin-actions">
      <button class="btn btn-outline btn-xl" type="button" data-back hidden>Back</button>
      <button class="btn btn-primary btn-xl" type="button" data-next>Next <span aria-hidden="true">&rarr;</span></button>
      <a class="btn btn-primary btn-xl" data-go href="/auth/start" hidden>OK, let's go <span aria-hidden="true">&rarr;</span></a>
      <a class="signin-revoke" href="/cloudflare-access" target="_blank" rel="noopener">You can make sure we revoke the access afterwards, or revoke it sooner, any time <svg viewBox="0 0 24 24" aria-hidden="true">${icons.out}</svg><span class="visually-hidden"> (opens in a new tab)</span></a>
    </div>
  </form>`;
document.body.append(dialog);

const go = dialog.querySelector("[data-go]");
const next = dialog.querySelector("[data-next]");
const back = dialog.querySelector("[data-back]");
const show = (step) => {
  for (const pane of dialog.querySelectorAll("[data-step]")) pane.hidden = pane.dataset.step !== String(step);
  dialog.querySelector("[data-count]").textContent = `Step ${step} / 2`;
  dialog.querySelectorAll(".signin-steps i")[1].classList.toggle("done", step === 2);
  dialog.setAttribute("aria-labelledby", `signin-title-${step}`);
  next.hidden = step === 2;
  go.hidden = back.hidden = step === 1;
  dialog.classList.remove("on");
  dialog.scrollTop = 0;
  if (step === 2) requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("on")));
  (step === 2 ? go : next).focus();
};
next.addEventListener("click", () => show(2));
back.addEventListener("click", () => show(1));
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

document.addEventListener("click", (event) => {
  const link = event.target.closest?.('a[href="/auth/start"]');
  if (!link || link === go || dialog.open || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (typeof dialog.showModal !== "function") return;
  event.preventDefault();
  go.href = link.getAttribute("href");
  dialog.showModal();
  show(1);
});
