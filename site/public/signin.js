const scopes = [
  ["card", "Account Settings Read", "Sees your accounts and checks for Workers Paid"],
  ["globe", "Artifacts Write", "A git repository for each project"],
  ["code", "Cloudchamber Write", "Starts and stops the sandboxes"],
  ["card", "User Details Read", "Knows who you are, to sign you in"],
  ["code", "Vectorize Write", "Saves each project's memory"],
  ["brain", "Workers AI Write", "Lets chef search that memory"],
  ["code", "Workers Containers Write", "Adds the sandboxes chef builds in"],
  ["code", "Workers Scripts Write", "Installs chef in your account"],
];

const icons = {
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M14 14h4"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>',
  brain: '<path d="M12 5.5v13M12 5.5A2.5 2.5 0 0 0 7.2 6 2.6 2.6 0 0 0 5 9.3a2.8 2.8 0 0 0 .4 4.6A2.7 2.7 0 0 0 8 18.4a2.4 2.4 0 0 0 4 .1M12 5.5A2.5 2.5 0 0 1 16.8 6 2.6 2.6 0 0 1 19 9.3a2.8 2.8 0 0 1-.4 4.6 2.7 2.7 0 0 1-2.6 4.5 2.4 2.4 0 0 1-4 .1"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
};
const shield = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8 3v6.2c0 4.6-3.3 8.4-8 9.8-4.7-1.4-8-5.2-8-9.8V5.5z" fill="#7a4a0e"/><path d="M12 7.5v6M12 16.5v.3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
const info = '<span class="cfc-info" aria-hidden="true">i</span>';

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
      <p class="signin-sub">There you give chef control of your Cloudflare account with the permissions below. The notes say why chef needs each one. All of them are on already, except <b>one switch at the bottom that you need to turn on.</b></p>
      <div class="consent">
        <svg class="consent-art" aria-hidden="true"></svg>
        <div class="cfc">
          <p class="cfc-head"><span>Permissions this app will be granted</span><span>${scopes.length} total permissions</span></p>
          <p class="cfc-label">Required ${info}</p>
          <ul class="cfc-scopes">
            ${scopes.map(([kind, name, why]) => `<li><span class="cfc-chip"><span class="cfc-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[kind]}</svg></span>${name}</span><p class="note">${why}</p></li>`).join("")}
          </ul>
          <p class="cfc-label cfc-extra">Additional access ${info}<span class="edit">Edit Permissions</span></p>
          <div class="cfc-sensitive"><span class="cfc-shield">${shield}</span><b>Sensitive scopes</b>${info}<span class="count">1 permission</span><span class="caret" aria-hidden="true"></span></div>
          <div class="cfc-toggle">
            <span><b>Account API Tokens Write</b><small>Grants write access to account API Tokens</small></span>
            <span class="cfc-switch" aria-hidden="true"><i></i></span>
          </div>
          <p class="note must"><strong>Turn this on!</strong>Cloudflare leaves it off for every app. chef uses it once, to make a token that only publishes your previews and live apps. Without it, previews won't work.</p>
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
const consent = dialog.querySelector(".consent");
const card = dialog.querySelector(".cfc");
const art = dialog.querySelector(".consent-art");

function arrow(sx, sy, ex, ey, loop) {
  const dx = ex - sx;
  const dy = ey - sy;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const flip = ux >= 0 ? 1 : -1;
  const vx = uy * flip;
  const vy = -ux * flip;
  const lift = Math.min(length * 0.6, 46);
  const at = (a, b) => `${(sx + ux * a * length + vx * b * lift).toFixed(1)} ${(sy + uy * a * length + vy * b * lift).toFixed(1)}`;
  const body = loop
    ? `M${at(0, 0)} C${at(0.18, -0.05)} ${at(0.32, 0.2)} ${at(0.44, 0.5)} C${at(0.5, 0.68)} ${at(0.4, 0.8)} ${at(0.36, 0.62)} C${at(0.32, 0.42)} ${at(0.5, 0.34)} ${at(0.64, 0.36)} C${at(0.8, 0.38)} ${at(0.92, 0.2)} ${at(1, 0)}`
    : `M${at(0, 0)} C${at(0.3, 0.18)} ${at(0.7, 0.2)} ${at(1, 0)}`;
  const tx = ux * 0.8 - vx * 0.6 * (lift / length);
  const ty = uy * 0.8 - vy * 0.6 * (lift / length);
  const tl = Math.hypot(tx, ty) || 1;
  const hx = tx / tl;
  const hy = ty / tl;
  const wing = (angle) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return `M${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - (hx * c - hy * s) * 10).toFixed(1)} ${(ey - (hx * s + hy * c) * 10).toFixed(1)}`;
  };
  return `${body} ${wing(0.5)} ${wing(-0.5)}`;
}

function layout() {
  if (!dialog.open || consent.offsetParent === null) return;
  const notes = [...consent.querySelectorAll(".note")];
  const wide = consent.clientWidth >= 548 + 2 * 250;
  consent.classList.toggle("stacked", !wide);
  for (const note of notes) note.removeAttribute("style");
  const box = consent.getBoundingClientRect();
  const local = (rect) => ({ left: rect.left - box.left, right: rect.right - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top, mid: (rect.top + rect.bottom) / 2 - box.top });
  const cardBox = local(card.getBoundingClientRect());
  const paths = [];
  const gap = 64;
  const width = Math.max(150, cardBox.left - gap);
  notes.forEach((note, i) => {
    const must = note.classList.contains("must");
    const target = must ? local(card.querySelector(".cfc-switch").getBoundingClientRect()) : local(note.previousElementSibling.getBoundingClientRect());
    note.style.setProperty("--delay", `${200 + i * 90}ms`);
    if (wide) {
      const left = !must && target.left + (target.right - target.left) / 2 < cardBox.left + (cardBox.right - cardBox.left) / 2;
      note.classList.toggle("left", left);
      note.style.width = `${width}px`;
      note.style.left = left ? `${-gap - width}px` : `${cardBox.right - cardBox.left + gap}px`;
      note.style.top = "0px";
      const height = note.offsetHeight;
      note.style.top = `${must ? target.top - cardBox.top - 56 : target.mid - cardBox.top - height / 2 + 4}px`;
      const own = local(note.getBoundingClientRect());
      const sy = must ? own.top + 18 : own.top + Math.min(height / 2 + 6, 24);
      paths.push([left ? arrow(own.right + 8, sy, target.left - 8, target.mid, true) : arrow(own.left - 8, sy, target.right + 10, target.mid, true), must]);
    } else {
      note.classList.remove("left");
      const own = local(note.getBoundingClientRect());
      if (must) {
        paths.push([arrow(own.left + 180, own.top + 14, target.left + (target.right - target.left) / 2, target.bottom + 8, false), true]);
        return;
      }
      const icon = local(note.previousElementSibling.querySelector(".cfc-ico").getBoundingClientRect());
      paths.push([arrow(own.left - 6, own.top + 12, icon.left + (icon.right - icon.left) / 2 + 2, icon.bottom + 5, false), false]);
    }
  });
  const spill = wide ? Math.max(0, ...notes.map((note) => local(note.getBoundingClientRect()).bottom - cardBox.bottom)) : 0;
  consent.style.paddingBottom = spill ? `${spill + 12}px` : "";
  const tall = consent.getBoundingClientRect().height;
  art.setAttribute("viewBox", `0 0 ${box.width} ${tall}`);
  art.innerHTML = paths.map(([d, must], i) => `<path d="${d}"${must ? ' class="must"' : ""} style="--delay:${260 + i * 90}ms"/>`).join("");
  for (const path of art.querySelectorAll("path")) path.style.setProperty("--len", Math.ceil(path.getTotalLength()));
}
new ResizeObserver(layout).observe(consent);
document.fonts?.ready.then(layout);

const show = (step) => {
  for (const pane of dialog.querySelectorAll("[data-step]")) pane.hidden = pane.dataset.step !== String(step);
  dialog.querySelector("[data-count]").textContent = `Step ${step} / 2`;
  dialog.querySelectorAll(".signin-steps i")[1].classList.toggle("done", step === 2);
  dialog.setAttribute("aria-labelledby", `signin-title-${step}`);
  dialog.classList.toggle("first", step === 1);
  next.hidden = step === 2;
  go.hidden = back.hidden = step === 1;
  dialog.classList.remove("on");
  dialog.scrollTop = 0;
  if (step === 2) {
    layout();
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("on")));
  }
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
