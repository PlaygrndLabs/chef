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
    frame = visible && !still ? requestAnimationFrame(loop) : 0;
  };
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

const COLS = 62;
const ROWS = 36;

function layout(draw) {
  const cells = new Map();
  const rect = (c0, r0, w, h, kind = "solid") => {
    for (let c = c0; c < c0 + w; c++) {
      for (let r = r0; r < r0 + h; r++) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
        const edge = c === c0 || r === r0 || c === c0 + w - 1 || r === r0 + h - 1;
        if (kind === "line" && !edge) continue;
        if (kind === "soft" && !edge && (c + r) % 2) continue;
        cells.set(r * COLS + c, kind === "solid" ? 1 : kind === "line" ? 0.75 : edge ? 0.6 : 0.35);
      }
    }
  };
  draw(rect);
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
      [9, 14, 11, 18, 15, 21, 17, 23].forEach((h, k) => rect(16 + k * 5, 33 - h, 3, h, k === 7 ? "solid" : "soft"));
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

function pixels(ctx, width, height) {
  const blue = brand();
  const fg = css("--foreground", "#111");
  const muted = css("--muted-foreground", "#777");
  const line = css("--border", "#e5e5e5");
  const card = css("--card", "#fff");
  const green = css("--success", "#16a34a");
  const W = 560;
  const H = 420;
  const scale = Math.min(width / W, height / H);
  const ox = (width - W * scale) / 2;
  const oy = (height - H * scale) / 2;
  const win = { x: 20, y: 74, w: 520, h: 340 };
  const step = 8;
  const grid = { x: win.x + (win.w - COLS * step) / 2, y: win.y + 34 };
  const cycle = 9;
  const rand = random(5);
  const count = Math.max(...apps.map((a) => a.cells.length));
  const scatter = () => {
    const a = rand() * Math.PI * 2;
    const d = 0.55 + rand() * 0.6;
    return { x: W / 2 + Math.cos(a) * W * d * 0.62, y: H / 2 + Math.sin(a) * H * d * 0.7 };
  };
  const dots = Array.from({ length: count }, () => ({ from: scatter(), to: scatter(), jitter: rand() }));
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const box = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  return (now) => {
    const total = still ? 5.5 : (now / 1000) % (cycle * apps.length);
    const index = Math.floor(total / cycle);
    const t = total - index * cycle;
    const app = apps[index];
    const ratio = ctx.canvas.width / width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * ox, ratio * oy);

    box(win.x + 0.5, win.y + 0.5, win.w, win.h, 14);
    ctx.fillStyle = card;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(win.x, win.y + 26.5);
    ctx.lineTo(win.x + win.w, win.y + 26.5);
    ctx.stroke();
    ctx.fillStyle = line;
    for (let d = 0; d < 3; d++) {
      ctx.beginPath();
      ctx.arc(win.x + 14 + d * 11, win.y + 13.5, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.fillText(app.host, win.x + win.w / 2, win.y + 17.5);
    ctx.textAlign = "start";

    ctx.fillStyle = blue;
    for (let k = 0; k < dots.length; k++) {
      const dot = dots[k];
      const cell = app.cells[k];
      let x;
      let y;
      let alpha;
      if (cell) {
        const tx = grid.x + (cell[0] % COLS) * step;
        const ty = grid.y + Math.floor(cell[0] / COLS) * step;
        const delay = ((cell[0] % COLS) / COLS) * 0.6 + dot.jitter * 0.5;
        const come = ease((t - 1.6 - delay) / 1.4);
        const go = ease((t - 7.4 - dot.jitter * 0.4) / 1.2);
        x = dot.from.x + (tx - dot.from.x) * come;
        y = dot.from.y + (ty - dot.from.y) * come;
        x += (dot.to.x - x) * go;
        y += (dot.to.y - y) * go;
        const shimmer = t > 3.6 && t < 7.4 ? 0.12 * Math.sin(t * 3 - (cell[0] % COLS) / 6) : 0;
        alpha = (0.1 + 0.9 * come) * (1 - go) * Math.min(1, cell[1] + shimmer);
      } else {
        x = dot.from.x;
        y = dot.from.y;
        alpha = 0;
      }
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, y, step - 1.5, step - 1.5);
    }
    ctx.globalAlpha = 1;
    if (t > 7.4 && !still) {
      for (const dot of dots) {
        dot.from = dot.to;
      }
    }
    if (t < 1 && !still) {
      for (const dot of dots) {
        if (dot.to === dot.from) dot.to = scatter();
      }
    }

    const typing = ease(Math.min(1, t / 1.3));
    const sent = t > 1.5;
    box(win.x + 0.5, 8.5, win.w, 42, 21);
    ctx.fillStyle = card;
    ctx.fill();
    ctx.strokeStyle = blue;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.font = "15px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = fg;
    const typed = app.prompt.slice(0, Math.round(app.prompt.length * typing));
    ctx.fillText(typed, win.x + 22, 35);
    if (!sent && Math.floor(now / 450) % 2 === 0) ctx.fillRect(win.x + 23 + ctx.measureText(typed).width, 21, 1.5, 18);
    ctx.fillStyle = blue;
    ctx.globalAlpha = sent ? 1 : 0.35;
    ctx.beginPath();
    ctx.arc(win.x + win.w - 22, 29.5, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = card;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(win.x + win.w - 22, 35);
    ctx.lineTo(win.x + win.w - 22, 24);
    ctx.moveTo(win.x + win.w - 27, 28.5);
    ctx.lineTo(win.x + win.w - 22, 23.5);
    ctx.lineTo(win.x + win.w - 17, 28.5);
    ctx.stroke();

    if (t > 3.6 && t < 8.2) {
      const fade = Math.min(1, (t - 3.6) / 0.4, (8.2 - t) / 0.4);
      ctx.globalAlpha = fade;
      ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
      const label = "live";
      const w = ctx.measureText(label).width + 26;
      const x = win.x + win.w - w - 10;
      ctx.fillStyle = green;
      ctx.globalAlpha = fade * 0.14;
      box(x, win.y + 5.5, w, 17, 8.5);
      ctx.fill();
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(x + 10, win.y + 14, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(label, x + 17, win.y + 18);
      ctx.globalAlpha = 1;
    }
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
      if (reach > 0 && rand() < reach * 0.85) points.push({ x, y, s: rand() * 6 });
    }
  }
  return (now) => {
    const t = now / 1000;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    for (const p of points) {
      const wave = Math.sin(t * 1.6 - p.x / 60 + p.y / 90) * 0.5 + 0.5;
      ctx.globalAlpha = 0.08 + 0.5 * wave * wave * (0.6 + 0.4 * Math.sin(p.s + t));
      const size = 1.5 + wave * 1.5;
      ctx.fillRect(p.x, p.y, size, size);
    }
    ctx.globalAlpha = 1;
  };
}

const scenes = { pixels, ascii, dots };
for (const [name, setup] of Object.entries(scenes)) {
  document.querySelectorAll(`[data-${name}]`).forEach((canvas) => animate(canvas, setup));
}
