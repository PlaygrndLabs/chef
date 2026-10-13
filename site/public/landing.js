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

const prompts = [
  { text: "Build a todo app with sign-in", lanes: ["Layout", "Todo list", "Sign-in"] },
  { text: "Add edit and delete to each item", lanes: ["Header", "Edit items", "Delete items"] },
  { text: "Make it work offline", lanes: ["Status bar", "Local store", "Sync on reconnect"] },
];

const appCols = 14;
const appRows = 15;
const regions = [
  (c, r) => r < 2 || (r === 3 && c > 1 && c < 9),
  (c, r) => r >= 5 && r <= 9 && r !== 7 && (c < 1 || (c > 1 && c < 11 - (r % 3) * 2)),
  (c, r) => r >= 11 && r <= 13 && ((c >= 0 && c < 6) || (c >= 7 && c < 13)) && r !== 12 || (r === 12 && (c === 0 || c === 5 || c === 7 || c === 12)),
];

function shape(r) {
  return Array.from({ length: appCols * appRows }, (_, i) => regions[r](i % appCols, Math.floor(i / appCols))).map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
}

function build(ctx, width, height) {
  const blue = brand();
  const fg = css("--foreground", "#111");
  const muted = css("--muted-foreground", "#777");
  const line = css("--border", "#e5e5e5");
  const card = css("--card", "#fff");
  const green = css("--success", "#16a34a");
  const W = 560;
  const H = 400;
  const scale = Math.min(width / W, height / H);
  const ox = (width - W * scale) / 2;
  const oy = (height - H * scale) / 2;
  const lanes = [120, 205, 290];
  const cycle = 11.5;
  const cell = 14;
  const app = { x: 334, y: 60, w: 222, h: 266 };
  const grid = { x: app.x + 12, y: app.y + 36 };
  const cells = regions.map((_, r) => shape(r));
  const order = [0, 1, 2].map((i) => {
    const rand = random(i + 21);
    return Array.from({ length: 30 }, (_, k) => k).sort(() => rand() - 0.5);
  });
  const timing = [2.6, 3.4, 2.3].map((dur, i) => {
    const start = 2.3 + i * 0.25;
    const built = start + dur;
    return { start, built, merged: built + 0.7, landed: built + 1.6 };
  });
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));
  const round = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  const mark = (x, y, s) => {
    ctx.fillStyle = blue;
    ctx.fillRect(x + s * 0.4, y, s * 0.6, s * 0.26);
    ctx.fillRect(x, y + s * 0.26, s * 0.4, s * 0.48);
    ctx.fillRect(x + s * 0.4, y + s * 0.74, s * 0.6, s * 0.26);
  };
  const chip = (x, y, label, tone) => {
    ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
    const w = ctx.measureText(label).width + 14;
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = tone;
    round(x, y - 8, w, 16, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = tone;
    ctx.fillText(label, x + 7, y + 3.5);
  };
  return (now) => {
    const total = still ? 9.5 : (now / 1000) % (cycle * prompts.length);
    const round_ = Math.floor(total / cycle);
    const t = total - round_ * cycle;
    const prompt = prompts[round_];
    const fade = t > cycle - 0.6 ? (cycle - t) / 0.6 : t < 0.3 ? t / 0.3 : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const ratio = ctx.canvas.width / width;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * ox, ratio * oy);
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";

    ctx.strokeStyle = blue;
    ctx.lineWidth = 1.2;
    round(0.5, 8.5, 318, 38, 19);
    ctx.fillStyle = card;
    ctx.fill();
    ctx.stroke();
    ctx.font = "13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = fg;
    const typed = prompt.text.slice(0, Math.floor(prompt.text.length * ease(t / 1.6)));
    ctx.globalAlpha = fade;
    ctx.fillText(typed, 18, 32);
    if (t < 2 && Math.floor(now / 450) % 2 === 0) ctx.fillRect(18 + ctx.measureText(typed).width + 2, 21, 1.5, 15);
    ctx.globalAlpha = 1;

    mark(8, lanes[1] - 14, 28);
    ctx.strokeStyle = line;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(22, 47);
    ctx.lineTo(22, lanes[1] - 18);
    ctx.stroke();
    const split = ease((t - 1.6) / 0.6);
    lanes.forEach((y) => {
      ctx.strokeStyle = split > 0 ? blue : line;
      ctx.globalAlpha = 0.25 + 0.5 * split;
      ctx.beginPath();
      ctx.moveTo(38, lanes[1]);
      ctx.bezierCurveTo(70, lanes[1], 70, y, 104, y);
      ctx.moveTo(232, y);
      ctx.lineTo(app.x, y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    lanes.forEach((y, i) => {
      const { start, built, merged, landed } = timing[i];
      const progress = (t - start) / (built - start);
      const box = { x: 104, y: y - 22, w: 128, h: 44 };
      ctx.fillStyle = card;
      ctx.strokeStyle = t > start ? blue : line;
      ctx.lineWidth = 1;
      round(box.x + 0.5, box.y + 0.5, box.w, box.h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = fade < 1 ? muted : fg;
      ctx.globalAlpha = split * fade;
      ctx.fillText(prompt.lanes[i], box.x, box.y - 8);
      const label = ctx.measureText(prompt.lanes[i]).width;
      if (t > start) chip(box.x + label + 8, box.y - 12, t < built ? "building" : t < merged ? "checking" : "merged", t < merged ? blue : green);
      ctx.globalAlpha = fade;
      const filled = Math.floor(30 * Math.max(0, Math.min(1, progress)));
      for (let k = 0; k < 30; k++) {
        const c = order[i][k];
        const cx = box.x + 9 + (c % 10) * 11;
        const cy = box.y + 7 + Math.floor(c / 10) * 11;
        const on = k < filled && t < landed;
        ctx.fillStyle = on ? blue : line;
        ctx.globalAlpha = fade * (on ? 0.55 + 0.45 * ((c * 7) % 5) / 4 : 0.6);
        ctx.fillRect(cx, cy, 8, 8);
      }
      if (t > built && t < merged) {
        ctx.globalAlpha = fade;
        ctx.strokeStyle = blue;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const a = (now / 160) % (Math.PI * 2);
        ctx.arc(box.x + box.w - 12, box.y + 12, 6, a, a + Math.PI * 1.4);
        ctx.stroke();
      }
      if (t > merged && t < landed + 0.4) {
        const targets = cells[i];
        for (let k = 0; k < 14; k++) {
          const p = ease((t - merged - k * 0.04) / 0.8);
          if (p <= 0 || p >= 1) continue;
          const dest = targets[(k * 5) % targets.length];
          const tx = grid.x + (dest % appCols) * cell;
          const ty = grid.y + Math.floor(dest / appCols) * cell;
          const sx = box.x + box.w - 10;
          const sy = y - 4 + (k % 3) * 4;
          ctx.globalAlpha = fade * (1 - p * 0.3);
          ctx.fillStyle = blue;
          ctx.fillRect(sx + (tx - sx) * p, sy + (ty - sy) * p, 7, 7);
        }
      }
      ctx.globalAlpha = 1;
    });

    ctx.fillStyle = card;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    round(app.x + 0.5, app.y + 0.5, app.w, app.h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(app.x, app.y + 24.5);
    ctx.lineTo(app.x + app.w, app.y + 24.5);
    ctx.stroke();
    ctx.fillStyle = line;
    for (let d = 0; d < 3; d++) {
      ctx.beginPath();
      ctx.arc(app.x + 12 + d * 10, app.y + 12.5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = muted;
    ctx.fillText("todo.workers.dev", app.x + 46, app.y + 16);
    for (let k = 0; k < appCols * appRows; k++) {
      const region = cells.findIndex((list) => list.includes(k));
      const x = grid.x + (k % appCols) * cell;
      const y = grid.y + Math.floor(k / appCols) * cell;
      let on = 0;
      if (region >= 0) on = ease((t - timing[region].merged - 0.5 - ((k * 13) % 9) * 0.04) / 0.4);
      ctx.fillStyle = line;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(x, y, cell - 3, cell - 3);
      if (on > 0) {
        ctx.fillStyle = blue;
        ctx.globalAlpha = on * fade * (region === 0 ? 1 : region === 1 ? 0.75 : 0.9);
        ctx.fillRect(x, y, cell - 3, cell - 3);
      }
    }
    ctx.globalAlpha = 1;
    const live = t - timing[2].landed;
    if (live > 0.3) {
      ctx.globalAlpha = fade;
      chip(app.x + app.w - 52, app.y + 12.5, "● live", green);
      const pulse = (live * 0.8) % 1;
      ctx.globalAlpha = fade * (1 - pulse) * 0.5;
      ctx.strokeStyle = green;
      round(app.x - pulse * 8 + 0.5, app.y - pulse * 8 + 0.5, app.w + pulse * 16, app.h + pulse * 16, 12 + pulse * 8);
      ctx.stroke();
    }
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

const scenes = { build, ascii, dots };
for (const [name, setup] of Object.entries(scenes)) {
  document.querySelectorAll(`[data-${name}]`).forEach((canvas) => animate(canvas, setup));
}
