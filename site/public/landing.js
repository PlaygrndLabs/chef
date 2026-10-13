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
  const step = 4;
  const k = 2;
  const blocks = features.map((f) => ({ ...f, x: f.x * k, w: f.w * k, h: f.h * k }));
  const ground = 392;
  const cycle = 13;
  const rand = random(9);
  const stars = Array.from({ length: 70 }, () => ({ x: rand() * W, y: 60 + rand() * 200, s: rand() * 6 }));
  const base = blocks.map(() => 0);
  blocks.forEach((f, i) => {
    base[i] = f.parent === undefined ? 0 : base[f.parent] + blocks[f.parent].h;
  });
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
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
    const hovered = pointer ? blocks.findIndex((f, i) => t > f.start && pointer.x >= f.x * step && pointer.x <= (f.x + f.w) * step && pointer.y <= ground - base[i] * step && pointer.y >= ground - (base[i] + f.h) * step) : -1;
    ctx.fillStyle = blue;
    ctx.globalAlpha = 0.07;
    for (let x = 2; x < W; x += 12) {
      for (let y = 66; y < ground - 4; y += 12) ctx.fillRect(x, y, 1, 1);
    }
    for (const star of stars) {
      const glow = near(star.x, star.y, 70);
      ctx.globalAlpha = 0.1 + 0.2 * (Math.sin(now / 700 + star.s) * 0.5 + 0.5) + 0.7 * glow;
      ctx.fillRect(star.x - glow, star.y - glow, 1.5 + glow * 2, 1.5 + glow * 2);
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

    blocks.forEach((f, i) => {
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
          const density = 0.3 + 0.7 * (1 - r / f.h);
          if (!edge && bayer[(r % 4) * 4 + (c % 4)] > density) continue;
          const spark = n > 0.94 && Math.sin(now / 700 + n * 40) > 0.6;
          let alpha = edge ? 0.85 : spark ? 1 : 0.3 + 0.4 * n;
          if (!done) alpha *= 0.55 + 0.45 * Math.sin(now / 120 + n * 9) ** 2;
          const cx = x0 + c * step;
          const cy = ground - (base[i] + r + 1) * step;
          const pull = near(cx + 2, cy + 2, 64);
          if (hovered === i) alpha = Math.min(1, alpha + 0.25);
          ctx.globalAlpha = fade * Math.min(1, alpha + pull * 0.5);
          const dot = 2.2 + pull * 0.8;
          ctx.fillRect(cx, cy - pull * pull * 10, dot, dot);
        }
      }
      const covered = blocks.some((g) => g.parent === i && t > g.start) && hovered !== i;
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
      ctx.fillRect(c * step, ground + 3, step - 1, 1.5);
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

const FINE = 2;
const COLS = 62 * FINE;
const ROWS = 36 * FINE;

function layout(draw) {
  const cells = new Map();
  const cell = (c0, r0, w, h, kind) => {
    for (let c = c0; c < c0 + w; c++) {
      for (let r = r0; r < r0 + h; r++) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
        const edge = c === c0 || r === r0 || c === c0 + w - 1 || r === r0 + h - 1;
        if (kind === "line" && !edge) continue;
        if (kind === "soft" && !edge && (c + r) % 2) continue;
        cells.set(r * COLS + c, kind === "solid" ? (edge ? 0.95 : 0.6) : kind === "line" ? 0.7 : edge ? 0.5 : 0.3);
      }
    }
  };
  draw((c0, r0, w, h, kind = "solid") => cell(c0 * FINE, r0 * FINE, w * FINE, h * FINE, kind));
  return [...cells.entries()];
}

const apps = [
  {
    prompt: "Build a todo app",
    host: "todo.workers.dev",
    cells: layout((rect) => {
      rect(0, 0, COLS, 4, "solid");
      rect(3, 7, 40, 4, "line");
      rect(46, 7, 13, 4, "solid");
      [26, 34, 20, 30, 24].forEach((w, k) => {
        rect(3, 14 + k * 4, 2, 2, k < 2 ? "solid" : "line");
        rect(8, 14 + k * 4, w, 2, k < 2 ? "soft" : "solid");
      });
      rect(3, 34, 18, 1, "soft");
    }),
  },
  {
    prompt: "Make a sales dashboard",
    host: "sales.workers.dev",
    cells: layout((rect) => {
      rect(0, 0, 12, ROWS, "soft");
      [3, 7, 11, 15].forEach((r, k) => rect(2, r, k ? 7 : 8, 2, k ? "line" : "solid"));
      [14, 30, 46].forEach((c) => {
        rect(c, 2, 14, 8, "line");
        rect(c + 2, 4, 6, 2, "solid");
        rect(c + 2, 7, 9, 1, "soft");
      });
      [9, 14, 11, 18, 15, 20, 17, 21].forEach((h, k) => rect(16 + k * 5, 33 - h, 3, h, k === 7 ? "solid" : "soft"));
      rect(14, 34, 46, 1, "solid");
    }),
  },
  {
    prompt: "Add a support chat",
    host: "support.workers.dev",
    cells: layout((rect) => {
      rect(0, 0, COLS, 4, "solid");
      rect(3, 7, 28, 5, "soft");
      rect(29, 14, 30, 4, "solid");
      rect(3, 20, 36, 7, "soft");
      rect(39, 24, 20, 3, "solid");
      rect(3, 31, 48, 4, "line");
      rect(53, 31, 6, 4, "solid");
    }),
  },
];

function app(ctx, width, height) {
  const blue = brand();
  const muted = css("--muted-foreground", "#777");
  const green = css("--success", "#16a34a");
  const canvas = ctx.canvas.getBoundingClientRect();
  const stage = ctx.canvas.parentElement?.querySelector(".stage")?.getBoundingClientRect();
  const box = stage && stage.width ? { x: stage.left - canvas.left, y: stage.top - canvas.top, w: stage.width, h: stage.height } : { x: width * 0.55, y: height * 0.2, w: width * 0.4, h: height * 0.6 };
  const step = box.w / COLS;
  const grid = { x: box.x, y: box.y + Math.max(36, (box.h - ROWS * step) / 2) };
  const cycle = 9;
  const rand = random(5);
  const count = Math.max(...apps.map((a) => a.cells.length));
  const loose = Math.round((width * height) / 2600);
  const dots = Array.from({ length: count + loose }, () => ({
    x: rand() * width,
    y: rand() * height,
    ax: 6 + rand() * 22,
    ay: 6 + rand() * 18,
    sx: 0.00012 + rand() * 0.00025,
    sy: 0.0001 + rand() * 0.0002,
    phase: rand() * 100,
    size: 1.2 + rand() * 1.2,
    jitter: rand(),
  }));
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  return (now) => {
    const total = still ? 5.5 : (now / 1000) % (cycle * apps.length);
    const index = Math.floor(total / cycle);
    const t = total - index * cycle;
    const app = apps[index];
    const ratio = ctx.canvas.width / width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const pointer = ctx.canvas.pointer;
    const time = still ? 0 : now;

    ctx.fillStyle = blue;
    for (let k = 0; k < dots.length; k++) {
      const dot = dots[k];
      let x = dot.x + Math.sin(time * dot.sx + dot.phase) * dot.ax;
      let y = dot.y + Math.cos(time * dot.sy + dot.phase * 1.3) * dot.ay;
      let alpha = 0.14 + 0.26 * (Math.sin(time / 900 + dot.phase) * 0.5 + 0.5);
      let size = dot.size;
      const cell = k < count ? app.cells[k] : undefined;
      if (cell) {
        const tx = grid.x + (cell[0] % COLS) * step;
        const ty = grid.y + Math.floor(cell[0] / COLS) * step;
        const delay = ((cell[0] % COLS) / COLS) * 0.6 + dot.jitter * 0.6;
        const here = ease((t - 1.4 - delay) / 1.5) * (1 - ease((t - 7.2 - dot.jitter * 0.5) / 1.3));
        const shimmer = t > 3.6 && t < 7.2 ? 0.12 * Math.sin(t * 3 - (cell[0] % COLS) / 6) : 0;
        x += (tx - x) * here;
        y += (ty - y) * here;
        alpha += (Math.min(1, cell[1] + shimmer) - alpha) * here;
        size += (step * 0.55 - size) * here;
      }
      if (pointer) {
        const d = Math.hypot(x - pointer.x, y - pointer.y) || 1;
        const push = Math.max(0, 1 - d / 90);
        x += ((x - pointer.x) / d) * push * push * 18;
        y += ((y - pointer.y) / d) * push * push * 18;
        alpha = Math.min(1, alpha + push * 0.45);
      }
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, y, size, size);
    }

    const typing = ease(Math.min(1, t / 1.3));
    const fade = still ? 1 : Math.min(1, t / 0.3, (cycle - t) / 0.5);
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = muted;
    ctx.globalAlpha = fade;
    const typed = `> ${app.prompt.slice(0, Math.round(app.prompt.length * typing))}`;
    ctx.fillText(typed, grid.x, grid.y - 18);
    if (t < 1.5 && Math.floor(now / 450) % 2 === 0) ctx.fillRect(grid.x + ctx.measureText(typed).width + 2, grid.y - 28, 6, 13);
    if (t > 3.6 && t < 8.2) {
      const below = grid.y + ROWS * step + 26;
      ctx.globalAlpha = Math.min(1, (t - 3.6) / 0.4, (8.2 - t) / 0.4);
      ctx.fillStyle = green;
      ctx.fillRect(grid.x, below - 6, 5, 5);
      ctx.fillStyle = muted;
      ctx.fillText(`${app.host} · live`, grid.x + 12, below);
    }
    ctx.globalAlpha = 1;
  };
}

const sessions = [
  { name: "todo-app", depth: 0, ask: 0, start: 0.2, build: 0 },
  { name: "layout", depth: 1, ask: 0, start: 1.6, build: 2.4 },
  { name: "todo list", depth: 1, ask: 0, start: 1.8, build: 2.9 },
  { name: "edit", depth: 2, ask: 1, start: 6.0, build: 2.6 },
  { name: "delete", depth: 2, ask: 1, start: 6.2, build: 2.3 },
  { name: "sign-in", depth: 1, ask: 2, start: 10.0, build: 2.6 },
];

const asks = [
  { text: "Build a todo app", at: 0, split: "2 sessions" },
  { text: "Add edit and delete", at: 4.4, split: "2 parallel sessions under todo list" },
  { text: "Let people sign in", at: 8.6, split: "1 session" },
];

function tree(ctx, width, height) {
  const color = brand();
  const muted = css("--muted-foreground", "#777");
  const green = css("--success", "#16a34a");
  const size = width < 420 ? 10 : 11;
  ctx.font = `500 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "top";
  const cw = ctx.measureText("M").width;
  const line = size + 4;
  const cols = Math.floor(width / cw);
  const name = Math.min(22, Math.max(17, Math.floor(cols * 0.4)));
  const status = 9;
  const bar = Math.max(6, cols - name - status - 2);
  const top = Math.max(0, Math.floor((height - line * (3 + sessions.length * 2)) / 2));
  const rand = random(11);
  const stars = Array.from({ length: Math.floor((width * height) / 900) }, () => ({ x: rand() * width, y: rand() * height, s: rand() * 6 }));
  const cycle = 16;
  const glyphs = "#=N@%";
  const text = (value, col, row, alpha, fill = color) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillText(value, col * cw, top + row * line);
  };
  return (now) => {
    const t = still ? 14 : (now / 1000) % cycle;
    const fade = still ? 1 : Math.min(1, t / 0.4, (cycle - t) / 0.8);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    for (const star of stars) {
      ctx.globalAlpha = 0.08 + 0.14 * (Math.sin(now / 770 + star.s) * 0.5 + 0.5);
      ctx.fillRect(star.x, star.y, 1.5, 1.5);
    }
    const ask = [...asks].reverse().find((a) => t >= a.at) ?? asks[0];
    const typed = ask.text.slice(0, Math.floor((t - ask.at) * 18));
    const cursor = typed.length < ask.text.length || Math.floor(now / 500) % 2 ? "_" : "";
    text(`> ${typed}${cursor}`, 0, 0, fade * 0.95, muted);
    if (t - ask.at > 1.3) text(`  router: ${ask.split}`, 0, 1, fade * Math.min(0.55, (t - ask.at - 1.3) * 2), color);
    const shown = sessions.filter((s) => t >= s.start);
    shown.forEach((s, index) => {
      const row = 3 + index * 2;
      const appear = Math.min(1, (t - s.start) * 3) * fade;
      const later = shown.slice(index + 1);
      const sibling = later.some((o) => o.depth === s.depth && !later.slice(0, later.indexOf(o)).some((p) => p.depth < s.depth));
      const outer = later.some((o) => o.depth === 1);
      const indent = s.depth === 0 ? "" : s.depth === 1 ? "" : outer ? "\u2502  " : "   ";
      const branch = s.depth === 0 ? "" : sibling ? "\u251c\u2500 " : "\u2514\u2500 ";
      const progress = s.build ? Math.min(1, Math.max(0, (t - s.start - 0.5) / s.build)) : 1;
      const live = progress >= 1;
      const mark = s.depth === 0 ? "\u25be" : live ? "\u25cf" : "|/-\\"[Math.floor(now / 120) % 4];
      text(indent + branch, 0, row, appear * 0.4, muted);
      const start = (indent + branch).length;
      text(mark, start, row, appear, live && s.depth ? green : color);
      text(s.name.slice(0, name - start - 3), start + 2, row, appear * (s.depth ? 0.9 : 1), s.depth ? undefined : color);
      if (!s.depth) return;
      const filled = Math.round(progress * bar);
      for (let k = 0; k < bar; k++) {
        const n = Math.sin((k + index * 31) * 12.9898 + row * 78.233 + (live ? 0 : Math.floor(now / 140))) * 43758.5453;
        const noise = n - Math.floor(n);
        const on = k < filled;
        const glyph = !on ? "." : k === 0 || k === bar - 1 ? "#" : live ? (k % 4 === 0 ? "=" : glyphs[Math.floor(noise * glyphs.length)]) : glyphs[Math.floor(noise * glyphs.length)];
        text(glyph, name + k, row, appear * (on ? 0.4 + 0.5 * noise : 0.18));
      }
      text(live ? "live" : progress > 0 ? `${Math.round(progress * 100)}%` : "queued", name + bar + 2, row, appear * (live ? 0.9 : 0.6), live ? green : muted);
    });
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

const scenes = { city, app, tree, dots };
for (const [name, setup] of Object.entries(scenes)) {
  document.querySelectorAll(`[data-${name}]`).forEach((canvas) => animate(canvas, setup));
}
