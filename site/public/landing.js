const messages = {
  unavailable: "Sign-in with Cloudflare opens soon. Please check back shortly.",
  cancelled: "Sign-in was cancelled. Try again whenever you are ready.",
  failed: "Cloudflare did not complete the sign-in. Please try again.",
};
const notice = document.getElementById("notice");
const reason = new URLSearchParams(location.search).get("signin");
if (notice && reason && messages[reason]) {
  notice.textContent = messages[reason];
  notice.hidden = false;
}

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("in");
    revealer.unobserve(entry.target);
  }
}, { rootMargin: "0px 0px -10% 0px" });
document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = `${(i % 3) * 80}ms`;
  revealer.observe(el);
});

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function brand() {
  return getComputedStyle(document.body).getPropertyValue("--brand").trim() || "#004dfc";
}

function animate(canvas, setup) {
  const ctx = canvas.getContext("2d");
  let scene = null;
  let visible = false;
  let frame = 0;
  const size = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    scene = setup(ctx, width, height);
    scene(performance.now());
  };
  const loop = (now) => {
    if (scene) scene(now);
    frame = visible && (!still || canvas.pointer) ? requestAnimationFrame(loop) : 0;
  };
  const area = canvas.parentElement || canvas;
  area.addEventListener("pointermove", (event) => {
    const box = canvas.getBoundingClientRect();
    canvas.pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (!frame) frame = requestAnimationFrame(loop);
  });
  area.addEventListener("pointerleave", () => {
    canvas.pointer = null;
    if (!frame) frame = requestAnimationFrame(loop);
  });
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !frame && !still) frame = requestAnimationFrame(loop);
  }).observe(canvas);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", size);
}

function css(name, fallback) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

const features = [
  { name: "Layout", ask: "Build a todo app", x: 2, w: 14, h: 14, start: 0.3, build: 2.2 },
  { name: "Todo list", ask: "Build a todo app", x: 18, w: 12, h: 22, start: 0.8, build: 2.6 },
  { name: "Sign-in", ask: "Let people sign in", x: 33, w: 10, h: 16, start: 1.4, build: 2.4 },
  { name: "Edit items", ask: "Add edit and delete", parent: 1, x: 19, w: 10, h: 11, start: 3.6, build: 2.0 },
  { name: "Delete items", ask: "Add edit and delete", parent: 0, x: 4, w: 10, h: 9, start: 3.9, build: 2.2 },
  { name: "Dark mode", ask: "Add a dark mode", x: 46, w: 10, h: 19, start: 4.3, build: 2.4 },
  { name: "Payments", ask: "Take payments", x: 58, w: 10, h: 26, start: 5.6, build: 2.8 },
  { name: "Offline", ask: "Make it work offline", parent: 2, x: 34, w: 8, h: 12, start: 6.1, build: 2.2 },
  { name: "Search", ask: "Add search", parent: 5, x: 47, w: 8, h: 9, start: 7.0, build: 2.0 },
];

function city(ctx, width, height) {
  const blue = brand();
  const fg = css("--foreground", "#111");
  const muted = css("--muted-foreground", "#777");
  const card = css("--card", "#fff");
  const green = css("--success", "#16a34a");
  const W = 560;
  const H = 420;
  const scale = Math.min(width / W, height / H);
  const ox = (width - W * scale) / 2;
  const oy = (height - H * scale) / 2;
  const step = 8;
  const ground = 392;
  const cycle = 13;
  const rand = random(9);
  const stars = Array.from({ length: 70 }, () => ({ x: rand() * W, y: 60 + rand() * 200, s: rand() * 6 }));
  const base = features.map(() => 0);
  features.forEach((f, i) => {
    base[i] = f.parent === undefined ? 0 : base[f.parent] + features[f.parent].h;
  });
  const noise = (a, b) => {
    const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  const pill = (x, y, label, tone, alpha) => {
    ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
    const w = ctx.measureText(label).width + 14;
    ctx.globalAlpha = alpha * 0.14;
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.roundRect(x, y - 8, w, 16, 8);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillText(label, x + 7, y + 3.5);
    return w;
  };
  return (now) => {
    const t = still ? 11.5 : (now / 1000) % cycle;
    const fade = still ? 1 : Math.min(1, t / 0.3, (cycle - t) / 0.6);
    const ratio = ctx.canvas.width / width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * ox, ratio * oy);

    const pointer = ctx.canvas.pointer ? { x: (ctx.canvas.pointer.x - ox) / scale, y: (ctx.canvas.pointer.y - oy) / scale } : null;
    const near = (x, y, reach) => (pointer ? Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / reach) : 0);
    const hovered = pointer ? features.findIndex((f, i) => t > f.start && pointer.x >= f.x * step && pointer.x <= (f.x + f.w) * step && pointer.y <= ground - base[i] * step && pointer.y >= ground - (base[i] + f.h) * step) : -1;
    ctx.fillStyle = blue;
    for (const star of stars) {
      const glow = near(star.x, star.y, 70);
      ctx.globalAlpha = 0.1 + 0.2 * (Math.sin(now / 700 + star.s) * 0.5 + 0.5) + 0.7 * glow;
      ctx.fillRect(star.x - glow * 1.5, star.y - glow * 1.5, 2 + glow * 3, 2 + glow * 3);
    }

    const current = [...features].reverse().find((f) => t > f.start) || features[0];
    ctx.globalAlpha = 1;
    ctx.fillStyle = card;
    ctx.strokeStyle = blue;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.roundRect(0.5, 8.5, 260, 36, 18);
    ctx.fill();
    ctx.stroke();
    ctx.font = "13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = fg;
    const since = t - current.start;
    const typed = current.ask.slice(0, Math.round(current.ask.length * Math.min(1, (since + 0.6) / 0.6)));
    ctx.globalAlpha = fade;
    ctx.fillText(typed, 18, 31);
    ctx.globalAlpha = 1;

    features.forEach((f, i) => {
      const progress = Math.max(0, Math.min(1, (t - f.start) / f.build));
      if (t < f.start) return;
      const done = progress >= 1;
      const x0 = f.x * step;
      const top = ground - (base[i] + f.h) * step;
      ctx.globalAlpha = fade * (done ? 0 : 0.5);
      ctx.strokeStyle = blue;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x0 - 1.5, top - 1.5, f.w * step + 2, f.h * step + 2);
      ctx.setLineDash([]);
      const rows = progress * f.h;
      ctx.fillStyle = blue;
      for (let r = 0; r < Math.ceil(rows); r++) {
        const partial = r >= Math.floor(rows);
        for (let c = 0; c < f.w; c++) {
          const n = noise(i * 31 + c, r);
          if (partial && n > rows - Math.floor(rows)) continue;
          const edge = c === 0 || c === f.w - 1 || r === f.h - 1;
          const window = !edge && c % 3 === 1 && r % 3 === 1;
          const lit = window && Math.sin(now / 900 + n * 20) > 0.3;
          let alpha = edge ? 1 : window ? (lit ? 0.15 : 0.35) : 0.55 + 0.35 * n;
          if (!done) alpha *= 0.55 + 0.45 * Math.sin(now / 120 + n * 9) ** 2;
          const cx = x0 + c * step;
          const cy = ground - (base[i] + r + 1) * step;
          const pull = near(cx + 3, cy + 3, 72);
          if (hovered === i) alpha = Math.min(1, alpha + 0.25);
          ctx.globalAlpha = fade * Math.min(1, alpha + pull * 0.5);
          ctx.fillRect(cx, cy - pull * pull * 12, step - 1.5, step - 1.5);
        }
      }
      const covered = features.some((g) => g.parent === i && t > g.start) && hovered !== i;
      const labelAlpha = fade * (covered ? 0 : 1);
      if (labelAlpha <= 0) return;
      ctx.font = "500 10.5px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = done && hovered !== i ? muted : fg;
      ctx.globalAlpha = labelAlpha;
      ctx.fillText(f.name, x0, top - 22);
      if (hovered === i && done) pill(x0, top - 9, "live", green, labelAlpha);
      const after = t - f.start - f.build;
      if (!done) pill(x0, top - 9, "building", blue, labelAlpha);
      else if (after < 1.4 && hovered !== i) pill(x0, top - 9, "merged", green, labelAlpha * Math.min(1, (1.4 - after) / 0.4));
    });

    ctx.globalAlpha = fade;
    ctx.fillStyle = blue;
    for (let c = 0; c < W / step; c++) {
      ctx.globalAlpha = fade * (c % 2 ? 0.35 : 0.7);
      ctx.fillRect(c * step, ground + 3, step - 1.5, 2);
    }
    ctx.globalAlpha = fade;
    ctx.font = "500 10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = muted;
    ctx.fillText("main", 0, ground + 20);
    const merged = features.filter((f) => t > f.start + f.build).length;
    ctx.textAlign = "right";
    ctx.fillText(`${merged} features live`, W, ground + 20);
    ctx.textAlign = "start";
    ctx.globalAlpha = 1;
  };
}

function ascii(ctx, width, height) {
  const color = brand();
  const cw = 7;
  const ch = 11;
  const cols = Math.floor(width / cw);
  const rows = Math.floor(height / ch);
  const count = width < 500 ? 4 : 5;
  const span = Math.floor(cols / (count + 1));
  const wide = Math.max(4, Math.floor(span * 0.7));
  const rand = random(11);
  const stars = Array.from({ length: Math.floor(cols * rows * 0.035) }, () => ({ x: Math.floor(rand() * cols), y: Math.floor(rand() * rows), s: rand() * 6 }));
  const glyphs = "#=N@%";
  ctx.font = `600 ${ch - 1}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "top";
  return (now) => {
    const t = now / 1000;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    for (const star of stars) {
      ctx.globalAlpha = 0.12 + 0.18 * (Math.sin(t * 1.3 + star.s) * 0.5 + 0.5);
      ctx.fillText(".", star.x * cw, star.y * ch);
    }
    const base = rows - 3;
    for (let b = 0; b < count; b++) {
      const level = 0.35 + 0.5 * (Math.sin(t * 0.7 + b * 1.7) * 0.5 + 0.5);
      const tall = Math.max(3, Math.floor((base - 4) * level));
      const x0 = Math.floor(span * (b + 0.65));
      for (let r = 0; r < tall; r++) {
        const y = base - r;
        for (let k = 0; k < wide; k++) {
          const top = r === tall - 1;
          const side = k === 0 || k === wide - 1;
          const n = Math.sin((x0 + k) * 12.9898 + y * 78.233 + Math.floor(t * 6)) * 43758.5453;
          const noise = n - Math.floor(n);
          let glyph = top ? "-" : side ? "#" : noise < 0.18 ? "=" : noise < 0.24 ? " " : glyphs[Math.floor(noise * glyphs.length)];
          if (!top && !side && r % 4 === 0) glyph = "=";
          ctx.globalAlpha = top ? 0.9 : 0.45 + 0.45 * noise;
          ctx.fillText(glyph, (x0 + k) * cw, y * ch);
        }
      }
    }
    ctx.globalAlpha = 0.35;
    for (let k = 0; k < cols; k++) ctx.fillText(k % 2 ? "-" : "=", k * cw, (base + 1) * ch);
    ctx.globalAlpha = 1;
  };
}

function dots(ctx, width, height) {
  const color = brand();
  const gap = 14;
  const rand = random(3);
  const points = [];
  for (let x = gap; x < width; x += gap) {
    for (let y = gap; y < height; y += gap) {
      const reach = (x / width - 0.45) / 0.55;
      if (rand() < Math.max(0.14, reach * 0.85)) points.push({ x, y, s: rand() * 6 });
    }
  }
  return (now) => {
    const t = now / 1000;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    const pointer = ctx.canvas.pointer;
    for (const p of points) {
      const wave = Math.sin(t * 1.6 - p.x / 60 + p.y / 90) * 0.5 + 0.5;
      const glow = pointer ? Math.max(0, 1 - Math.hypot(p.x - pointer.x, p.y - pointer.y) / 90) : 0;
      ctx.globalAlpha = Math.min(1, 0.08 + 0.5 * wave * wave * (0.6 + 0.4 * Math.sin(p.s + t)) + glow * 0.8);
      const size = 1.5 + wave * 1.5 + glow * 2.5;
      ctx.fillRect(p.x, p.y, size, size);
    }
    ctx.globalAlpha = 1;
  };
}

const scenes = { city, ascii, dots };
for (const [name, setup] of Object.entries(scenes)) {
  document.querySelectorAll(`[data-${name}]`).forEach((canvas) => animate(canvas, setup));
}
