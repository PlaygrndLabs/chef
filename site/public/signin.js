const scopes = [
  ["card", "Account Settings Read", "so we can make sure your account has Workers Paid"],
  ["globe", "Artifacts Write", "so we can make a git repository for each project"],
  ["code", "Cloudchamber Write", "so we can start and stop your sandboxes"],
  ["card", "User Details Read", "so we can sign you in"],
  ["code", "Vectorize Write", "so we can save each project's memory"],
  ["brain", "Workers AI Write", "so we can search that memory"],
  ["code", "Workers Containers Write", "so we can add the sandboxes chef builds in"],
  ["code", "Workers Scripts Write", "so we can install chef in your account"],
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
      <p class="signin-sub">There you give chef control of your Cloudflare account with the permissions below. The notes say why chef needs each one. All of them are on already, except <b>one switch at the bottom. Turn it on, or sign-in fails.</b></p>
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
          <p class="note must"><strong>turn this on!</strong>or sign-in fails. so we can publish your previews and live apps</p>
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

function seeded(seed) {
  let n = seed * 9301 + 49297;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

function arrow(sx, sy, ex, ey, seed) {
  const rand = seeded(seed);
  const dx = ex - sx;
  const dy = ey - sy;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const side = rand() < 0.5 ? -1 : 1;
  const bend = Math.min(length * (0.12 + rand() * 0.18), 34) * side;
  const lean = 0.25 + rand() * 0.2;
  const c1x = sx + dx * lean + nx * bend;
  const c1y = sy + dy * lean + ny * bend;
  const c2x = sx + dx * (0.62 + rand() * 0.18) + nx * bend * (0.15 + rand() * 0.5);
  const c2y = sy + dy * (0.62 + rand() * 0.18) + ny * bend * (0.15 + rand() * 0.5);
  const phase = rand() * Math.PI * 2;
  const points = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const u = 1 - t;
    const shake = Math.sin(t * Math.PI * 3 + phase) * 0.7 * Math.sin(t * Math.PI);
    points.push([
      u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex + nx * shake,
      u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey + ny * shake,
    ]);
  }
  const hx = ex - c2x;
  const hy = ey - c2y;
  const hl = Math.hypot(hx, hy) || 1;
  const wing = (angle, size) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const wx = ex - ((hx * c - hy * s) / hl) * size;
    const wy = ey - ((hx * s + hy * c) / hl) * size;
    return `M${wx.toFixed(1)} ${wy.toFixed(1)} Q${((wx + ex) / 2 + rand() - 0.5).toFixed(1)} ${((wy + ey) / 2 + rand() - 0.5).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  };
  return `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} ${wing(0.42 + rand() * 0.2, 10 + rand() * 4)} ${wing(-0.38 - rand() * 0.22, 9 + rand() * 4)}`;
}

function ring(box) {
  const cx = (box.left + box.right) / 2;
  const cy = box.mid;
  const rx = (box.right - box.left) / 2 + 14;
  const ry = (box.bottom - box.top) / 2 + 10;
  const points = [];
  for (let i = 0; i <= 80; i++) {
    const angle = -2.4 + (i / 80) * (Math.PI * 2 + 0.6);
    const wobble = 1 + 0.05 * Math.sin(angle * 3) + i * 0.0012;
    points.push(`${(cx + Math.cos(angle) * rx * wobble).toFixed(1)} ${(cy + Math.sin(angle) * ry * wobble).toFixed(1)}`);
  }
  return `M${points.join(" L")}`;
}

function lines(note) {
  const walker = document.createTreeWalker(note, 4);
  const rects = [];
  const range = document.createRange();
  while (walker.nextNode()) {
    range.selectNodeContents(walker.currentNode);
    rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 4));
  }
  return rects;
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
  const gap = 52;
  const width = Math.max(150, cardBox.left - gap - 20);
  const sensitive = local(card.querySelector(".cfc-sensitive").getBoundingClientRect());
  const side = (note) => {
    if (note.classList.contains("must")) return "must";
    const chip = local(note.previousElementSibling.getBoundingClientRect());
    return (chip.left + chip.right) / 2 < (cardBox.left + cardBox.right) / 2 ? "left" : "right";
  };
  const groups = { left: notes.filter((note) => side(note) === "left"), right: notes.filter((note) => side(note) === "right") };
  const slot = (note) => {
    const group = groups[side(note)];
    const top = cardBox.top + 6;
    const bottom = side(note) === "left" ? cardBox.bottom - 6 : sensitive.top - 24;
    const step = (bottom - top) / group.length;
    return top + step * (group.indexOf(note) + 0.5);
  };
  notes.forEach((note, i) => {
    const rand = seeded(i + 3);
    const must = note.classList.contains("must");
    const chip = note.previousElementSibling;
    const target = must ? local(card.querySelector(".cfc-switch").getBoundingClientRect()) : local(chip.getBoundingClientRect());
    note.style.setProperty("--delay", `${200 + i * 90}ms`);
    note.style.rotate = `${((rand() - 0.5) * (must ? 3 : 5)).toFixed(2)}deg`;
    if (wide) {
      const left = side(note) === "left";
      note.classList.toggle("left", left);
      note.style.width = `${width}px`;
      const shift = Math.round(rand() * 22);
      note.style.left = left ? `${-gap - width - shift}px` : `${cardBox.right - cardBox.left + gap + shift}px`;
      note.style.top = "0px";
      const height = note.offsetHeight;
      const drift = Math.round((rand() - 0.5) * 18);
      note.style.top = `${must ? target.top - cardBox.top - 74 : slot(note) - cardBox.top - height / 2 + drift}px`;
      const rows = lines(note).map(local);
      const line = must ? rows[0] : rows.reduce((best, row) => (Math.abs(row.mid - target.mid) < Math.abs(best.mid - target.mid) ? row : best), rows[0]);
      if (must) {
        paths.push([ring(target), true]);
        paths.push([arrow(line.left - 10, line.mid + 4, target.right + 18, target.top - 2, i + 11), true]);
      } else if (left) paths.push([arrow(line.right + 10, line.mid + 2, target.left - 8, target.mid, i + 11), false]);
      else paths.push([arrow(line.left - 10, line.mid + 2, target.right + 8, target.mid, i + 11), false]);
    } else {
      note.classList.remove("left");
      note.style.marginLeft = must ? "" : `${66 + Math.round(rand() * 22)}px`;
      const first = local(lines(note)[0]);
      if (must) {
        paths.push([ring(target), true]);
        paths.push([arrow(first.right + 12, first.mid, (target.left + target.right) / 2 - 4, target.bottom + 13, i + 11), true]);
        return;
      }
      const icon = local(chip.querySelector(".cfc-ico").getBoundingClientRect());
      paths.push([arrow(first.left - 8, first.mid + 2, (icon.left + icon.right) / 2, icon.bottom + 6, i + 11), false]);
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
