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

function tiles(ctx, width, height) {
  const color = brand();
  const shades = [color, "#2f6bff", "#5b8cff", "#93b4ff"];
  const tile = width < 600 ? 40 : 56;
  const gap = width < 600 ? 6 : 10;
  const step = tile + gap;
  const cols = Math.max(1, Math.floor((width + gap) / step));
  const rows = Math.max(1, Math.floor((height + gap) / step));
  const left = width - cols * step + gap;
  const rand = random(7);
  const heights = Array.from({ length: cols }, (_, c) => Math.max(1, Math.round(rows * (0.35 + 0.65 * rand()) * (0.55 + 0.45 * c / cols))));
  const cells = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      cells.push({ c, r, seed: rand() * 1000, hollow: rand() < 0.16, alpha: 0, shade: Math.floor(rand() * shades.length) });
    }
  }
  const bars = width < 600 ? 7 : 9;
  const bar = tile / (bars * 2 - 1);
  let changed = 0;
  return (now) => {
    const t = now / 1000;
    if (now - changed > 900) {
      changed = now;
      const c = Math.floor(rand() * cols);
      heights[c] = Math.min(rows, Math.max(1, heights[c] + (rand() < 0.5 ? -1 : 1)));
      const cell = cells[Math.floor(rand() * cells.length)];
      cell.hollow = !cell.hollow;
    }
    ctx.clearRect(0, 0, width, height);
    for (const cell of cells) {
      const on = rows - cell.r <= heights[cell.c];
      cell.alpha += ((on ? 1 : 0) - cell.alpha) * (still ? 1 : 0.06);
      if (cell.alpha < 0.02) continue;
      const x = left + cell.c * step;
      const y = cell.r * step;
      ctx.globalAlpha = cell.alpha;
      for (let i = 0; i < bars; i++) {
        const bx = x + i * bar * 2;
        const edge = i === 0 || i === bars - 1;
        ctx.fillStyle = shades[(cell.shade + i) % shades.length];
        if (cell.hollow && !edge) {
          ctx.fillRect(bx, y, bar, tile * 0.16);
          ctx.fillRect(bx, y + tile * 0.84, bar, tile * 0.16);
          continue;
        }
        const wave = Math.sin(t * 1.4 + cell.seed + i * 0.9) * 0.5 + 0.5;
        const hole = y + tile * (0.15 + 0.6 * wave);
        ctx.fillRect(bx, y, bar, hole - y);
        ctx.fillRect(bx, hole + tile * 0.08, bar, y + tile - hole - tile * 0.08);
      }
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

const scenes = { tiles, ascii, dots };
for (const [name, setup] of Object.entries(scenes)) {
  document.querySelectorAll(`[data-${name}]`).forEach((canvas) => animate(canvas, setup));
}
