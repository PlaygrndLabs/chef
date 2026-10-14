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
  canvas.redraw = () => {
    if (!frame) frame = requestAnimationFrame(loop);
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
    prompt: "Build a video editor with AI captions",
    host: "cut.workers.dev",
    cells: layout((rect) => {
      rect(0, 0, 62, 3, "solid");
      rect(0, 5, 40, 18, "line");
      rect(18, 11, 2, 5, "solid");
      rect(20, 12, 1, 3, "solid");
      rect(10, 19, 20, 1, "soft");
      rect(42, 5, 20, 18, "line");
      [8, 11, 14, 17].forEach((r, k) => {
        rect(44, r, 8, 1, "soft");
        rect(54, r, k % 2 ? 4 : 6, 1, "solid");
      });
      rect(0, 25, 62, 1, "soft");
      [[0, 14], [15, 10], [26, 18], [45, 17]].forEach(([c, w]) => rect(c, 27, w, 2, "solid"));
      [[4, 20], [30, 22]].forEach(([c, w]) => rect(c, 30, w, 2, "soft"));
      [[2, 6], [10, 8], [20, 5], [27, 9], [38, 7], [47, 10]].forEach(([c, w]) => rect(c, 33, w, 2, "line"));
    }),
    move: (p, rect) => {
      rect(p * 61, 24, 1, 12);
      rect(10, 19, Math.round(4 + p * 16), 1);
    },
  },
  {
    prompt: "Make a multiplayer whiteboard",
    host: "board.workers.dev",
    cells: layout((rect) => {
      rect(0, 0, 4, 36, "line");
      [3, 7, 11, 15, 19].forEach((r, k) => rect(1, r, 2, 2, k === 1 ? "solid" : "line"));
      rect(48, 1, 3, 3, "solid");
      rect(52, 1, 3, 3, "soft");
      rect(56, 1, 3, 3, "line");
      rect(10, 7, 10, 8, "soft");
      rect(24, 6, 10, 8, "line");
      rect(26, 8, 6, 1, "solid");
      rect(26, 10, 4, 1, "soft");
      rect(40, 9, 12, 8, "soft");
      rect(14, 22, 12, 9, "line");
      rect(34, 23, 14, 9, "soft");
      rect(20, 11, 4, 1, "solid");
      rect(34, 12, 6, 1, "solid");
      rect(29, 14, 1, 9, "solid");
      rect(26, 26, 8, 1, "solid");
    }),
    move: (p, rect) => {
      const a = { c: 12 + Math.sin(p * 6) * 6 + p * 22, r: 18 + Math.cos(p * 5) * 3 };
      const b = { c: 52 - p * 14, r: 28 - p * 6 };
      rect(a.c, a.r, 2, 2);
      rect(a.c + 3, a.r + 2, 5, 1);
      rect(b.c, b.r, 2, 2);
      rect(b.c + 3, b.r + 2, 4, 1);
      rect(50, 33, Math.round(p * 10), 1);
    },
  },
  {
    prompt: "Build a CRM with a sales pipeline",
    host: "deals.workers.dev",
    cells: layout((rect) => {
      rect(0, 0, 10, 36, "line");
      [2, 6, 9, 12, 15].forEach((r, k) => rect(2, r, k ? 6 : 7, 1, k ? "soft" : "solid"));
      rect(12, 1, 30, 3, "line");
      rect(54, 1, 8, 3, "solid");
      [[5, 4, 6], [6, 5], [4, 6, 4], [5]].forEach((cards, k) => {
        const c = 12 + k * 13;
        rect(c, 6, 7, 1, "solid");
        rect(c + 9, 6, 2, 1, "soft");
        let y = 9;
        cards.forEach((h) => {
          rect(c, y, 11, h, "line");
          rect(c + 1, y + 1, 7, 1, "soft");
          rect(c + 1, y + h - 2, 4, 1, "solid");
          y += h + 1;
        });
      });
    }),
    move: (p, rect) => {
      const f = Math.max(0, Math.min(1, (p - 0.15) / 0.6));
      const e = f * f * f * (f * (f * 6 - 15) + 10);
      const c = 25 + e * 13;
      const r = 22 + e * 4 - Math.sin(e * Math.PI) * 1.5;
      rect(c, r, 11, 0.5);
      rect(c, r + 4.5, 11, 0.5);
      rect(c, r, 0.5, 5);
      rect(c + 10.5, r, 0.5, 5);
      rect(c + 1, r + 1, 7, 1);
      rect(c + 1, r + 3, 4, 1);
    },
  },
  {
    prompt: "Track deliveries on a live map",
    host: "fleet.workers.dev",
    cells: layout((rect) => {
      rect(0, 0, 42, 36, "line");
      [6, 14, 22, 30].forEach((r) => rect(1, r, 40, 1, "soft"));
      [8, 18, 28, 36].forEach((c) => rect(c, 1, 1, 34, "soft"));
      rect(10, 16, 7, 5, "soft");
      rect(30, 24, 5, 5, "soft");
      rect(8, 22, 1, 9);
      rect(8, 22, 21, 1);
      rect(28, 6, 1, 17);
      rect(28, 6, 9, 1);
      rect(7, 30, 3, 3);
      rect(35, 4, 3, 3);
      rect(45, 1, 17, 3);
      [7, 13, 19, 25].forEach((r, k) => {
        rect(45, r, 17, 5, "line");
        rect(47, r + 1, 8, 1, "soft");
        rect(47, r + 3, 5, 1);
        rect(58, r + 1, 2, 2, k ? "line" : "solid");
      });
      rect(45, 32, 17, 2, "soft");
    }),
    move: (p, rect) => {
      const path = [[8, 31], [8, 22], [28, 22], [28, 6], [36, 6]];
      const lengths = path.slice(1).map(([c, r], k) => Math.abs(c - path[k][0]) + Math.abs(r - path[k][1]));
      let left = p * lengths.reduce((x, y) => x + y, 0);
      let at = path[0];
      for (let k = 0; k < lengths.length; k++) {
        const f = Math.min(1, left / lengths[k]);
        at = [path[k][0] + (path[k + 1][0] - path[k][0]) * f, path[k][1] + (path[k + 1][1] - path[k][1]) * f];
        left -= lengths[k];
        if (left <= 0) break;
      }
      rect(at[0] - 1, at[1] - 1, 3, 3);
      rect(45, 32, Math.round(p * 17), 2);
    },
  },
];

function moving(app, p) {
  const cells = [];
  app.move(p, (c0, r0, w, h) => {
    const x = c0 * FINE;
    const y = r0 * FINE;
    for (let i = 0; i < Math.max(1, Math.round(w * FINE)); i++) {
      for (let j = 0; j < Math.max(1, Math.round(h * FINE)); j++) {
        const c = x + i;
        const r = y + j;
        if (c >= 0 && r >= 0 && c < COLS && r < ROWS) cells.push([c, r]);
      }
    }
  });
  return cells;
}

const MARK = [[96, 0, 240, 70], [0, 70, 96, 200], [96, 200, 240, 270]];

function voxels(pitch, room) {
  const depth = 72;
  const boxes = MARK.map(([x0, y0, x1, y1]) => ({ lo: [x0, 270 - y1, 0], hi: [x1, 270 - y0, depth] }));
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((k) => k / l);
  };
  const dir = norm([-0.5, -0.42, -1]);
  const right = norm([-dir[2], 0, dir[0]]);
  const up = [right[1] * dir[2] - right[2] * dir[1], right[2] * dir[0] - right[0] * dir[2], right[0] * dir[1] - right[1] * dir[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const box of boxes) {
    for (let k = 0; k < 8; k++) {
      const p = [k & 1 ? box.hi[0] : box.lo[0], k & 2 ? box.hi[1] : box.lo[1], k & 4 ? box.hi[2] : box.lo[2]];
      const x = dot(p, right);
      const y = dot(p, up);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const unit = Math.min(room.w / (maxX - minX), room.h / (maxY - minY));
  const cols = Math.floor(((maxX - minX) * unit) / pitch);
  const rows = Math.floor(((maxY - minY) * unit) / pitch);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = minX + ((c + 0.5) * pitch) / unit;
      const sy = maxY - ((r + 0.5) * pitch) / unit;
      const origin = [0, 1, 2].map((k) => sx * right[k] + sy * up[k] - dir[k] * 2000);
      let best = Infinity;
      let face = 0;
      let at = null;
      for (const box of boxes) {
        let near = -Infinity;
        let far = Infinity;
        let axis = -1;
        for (let k = 0; k < 3; k++) {
          const t1 = (box.lo[k] - origin[k]) / dir[k];
          const t2 = (box.hi[k] - origin[k]) / dir[k];
          const enter = Math.min(t1, t2);
          if (enter > near) {
            near = enter;
            axis = k;
          }
          far = Math.min(far, Math.max(t1, t2));
        }
        if (near <= far && near < best) {
          best = near;
          face = axis === 2 ? 1 : axis === 1 ? 2 : 3;
          at = origin.map((v, k) => v + dir[k] * near);
        }
      }
      if (face) cells.push({ c, r, face, depth: at[2] / depth, height: at[1] / 270 });
    }
  }
  return { cols, rows, cells, w: cols * pitch, h: rows * pitch };
}

function mark(ctx, width, height) {
  const blue = brand();
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const canvas = ctx.canvas.getBoundingClientRect();
  const stage = ctx.canvas.parentElement?.querySelector(".stage")?.getBoundingClientRect();
  const room = stage && stage.width ? { x: stage.left - canvas.left, y: stage.top - canvas.top, w: stage.width, h: stage.height } : { x: width * 0.55, y: height * 0.2, w: width * 0.4, h: height * 0.6 };
  const pitch = width < 600 ? 5 : 6;
  const shape = voxels(pitch, { w: room.w * 0.8, h: room.h * 0.8 });
  const ox = Math.round(room.x + (room.w - shape.w) / 2);
  const oy = Math.round(room.y + (room.h - shape.h) / 2);
  const tones = dark ? { 1: [blue, 1], 2: ["#c4d4ff", 0.9], 3: [blue, 0.4] } : { 1: [blue, 1], 2: [blue, 0.36], 3: ["#062a8c", 1] };
  const rand = random(5);
  const cells = shape.cells.map((cell) => ({ ...cell, x: ox + cell.c * pitch, y: oy + cell.r * pitch, n: rand(), intro: (1 - cell.height) * 0.9 + rand() * 0.35 }));
  const tops = cells.filter((cell) => cell.face === 2);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const shadow = [];
  const floor = { x: ox + shape.w * 0.55, y: oy + shape.h + pitch * 3, rx: shape.w * 0.7, ry: pitch * 5 };
  for (let y = floor.y - floor.ry; y < floor.y + floor.ry; y += pitch) {
    for (let x = floor.x - floor.rx; x < floor.x + floor.rx; x += pitch) {
      const d = Math.hypot((x - floor.x) / floor.rx, (y - floor.y) / floor.ry);
      const c = Math.round(x / pitch);
      const r = Math.round(y / pitch);
      if (d < 1 && (1 - d) * 0.9 > (bayer[(r & 3) * 4 + (c & 3)] + 0.5) / 16) shadow.push({ x, y, a: 0.25 + 0.35 * (1 - d) });
    }
  }
  const clear = { x0: ox - 24, y0: oy - 24, x1: ox + shape.w + 24, y1: floor.y + floor.ry + 12 };
  const dots = Array.from({ length: Math.round((width * height) / 450) }, () => ({
    x: rand() * width,
    y: rand() * height,
    ax: 6 + rand() * 22,
    ay: 6 + rand() * 18,
    sx: 0.00012 + rand() * 0.00025,
    sy: 0.0001 + rand() * 0.0002,
    phase: rand() * 100,
    size: 1.2 + rand() * 1.2,
  })).filter((d) => !(d.x > clear.x0 && d.x < clear.x1 && d.y > clear.y0 && d.y < clear.y1));
  const steam = Array.from({ length: 46 }, (_, k) => ({ from: tops[Math.floor(rand() * tops.length)], born: -rand() * 6, life: 4 + rand() * 3, drift: 4 + rand() * 10, rise: 9 + rand() * 9, phase: rand() * 9, k }));
  const start = performance.now();
  return (now) => {
    const ratio = ctx.canvas.width / width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const pointer = ctx.canvas.pointer;
    const time = still ? 0 : now;
    const since = still ? 9 : (now - start) / 1000;

    ctx.fillStyle = blue;
    for (const dot of dots) {
      let x = dot.x + Math.sin(time * dot.sx + dot.phase) * dot.ax;
      let y = dot.y + Math.cos(time * dot.sy + dot.phase * 1.3) * dot.ay;
      let alpha = 0.14 + 0.26 * (Math.sin(time / 900 + dot.phase) * 0.5 + 0.5);
      if (pointer) {
        const d = Math.hypot(x - pointer.x, y - pointer.y) || 1;
        const push = Math.max(0, 1 - d / 90);
        x += ((x - pointer.x) / d) * push * push * 18;
        y += ((y - pointer.y) / d) * push * push * 18;
        alpha = Math.min(1, alpha + push * 0.45);
      }
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, y, dot.size, dot.size);
    }

    ctx.fillStyle = blue;
    for (const dot of shadow) {
      ctx.globalAlpha = dot.a * Math.min(1, since / 1.2);
      ctx.fillRect(dot.x, dot.y, pitch * 0.45, pitch * 0.45);
    }

    const side = pitch - 1.4;
    for (const cell of cells) {
      const show = Math.max(0, Math.min(1, (since - cell.intro) / 0.35));
      if (!show) continue;
      const [color, base] = tones[cell.face];
      let alpha = base * (0.86 + 0.14 * cell.n) * show;
      let lift = (1 - show) * 10;
      if (pointer) {
        const near = Math.max(0, 1 - Math.hypot(cell.x - pointer.x, cell.y - pointer.y) / 70);
        lift += near * near * 5;
        alpha = Math.min(1, alpha + near * 0.25);
      }
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(cell.x, cell.y - lift, side, side);
    }

    if (!still && tops.length) {
      ctx.fillStyle = blue;
      for (const puff of steam) {
        let age = since - 1.2 - puff.born;
        if (age < 0) continue;
        const round = Math.floor(age / puff.life);
        age -= round * puff.life;
        const from = round ? tops[Math.floor(Math.abs(Math.sin(puff.k * 12.9 + round * 7.7)) * tops.length) % tops.length] : puff.from;
        const p = age / puff.life;
        const x = from.x + age * puff.drift + Math.sin(age * 1.3 + puff.phase) * 3;
        const y = from.y - age * puff.rise;
        ctx.globalAlpha = 0.5 * Math.sin(p * Math.PI) * (dark ? 0.9 : 0.75);
        const size = 2.2 + p * 1.6;
        ctx.fillRect(x, y, size, size);
      }
    }
    ctx.globalAlpha = 1;
  };
}

const showcaseNames = ["01 video editor", "02 whiteboard", "03 sales pipeline", "04 delivery map"];

function showcase(ctx, width, height) {
  const blue = brand();
  const muted = css("--muted-foreground", "#777");
  const green = css("--success", "#16a34a");
  const pad = width < 600 ? 16 : 32;
  const gridW = Math.min(width - pad * 2, (height - 92) * (COLS / ROWS));
  const step = gridW / COLS;
  const grid = { x: Math.round((width - gridW) / 2), y: 46 };
  const cycle = 11;
  const rand = random(5);
  const count = Math.max(...apps.map((a) => a.cells.length));
  const dots = Array.from({ length: count + Math.round((width * height) / 3600) }, () => ({
    x: rand() * width,
    y: rand() * height,
    ax: 4 + rand() * 14,
    ay: 4 + rand() * 12,
    sx: 0.00012 + rand() * 0.00025,
    sy: 0.0001 + rand() * 0.0002,
    phase: rand() * 100,
    size: 1.2 + rand() * 1.2,
    jitter: rand(),
  }));
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const label = ctx.canvas.closest(".term")?.querySelector("[data-showcase-label]");
  const host = ctx.canvas.closest(".term")?.querySelector("[data-showcase-host]");
  let start = null;
  let shownIndex = -1;
  return (now) => {
    const box = ctx.canvas.getBoundingClientRect();
    if (start === null && box.top < window.innerHeight && box.bottom > 0) start = now;
    const total = still ? 6.2 : start === null ? 0 : (now - start) / 1000;
    const index = Math.floor(total / cycle) % apps.length;
    const t = still ? 6.2 : total % cycle;
    const app = apps[index];
    if (index !== shownIndex) {
      shownIndex = index;
      if (label) label.textContent = showcaseNames[index];
      if (host) host.textContent = app.host;
    }
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
      let alpha = 0.1 + 0.18 * (Math.sin(time / 1100 + dot.phase) * 0.5 + 0.5);
      let size = dot.size;
      const cell = k < count ? app.cells[k] : undefined;
      if (cell) {
        const tx = grid.x + (cell[0] % COLS) * step;
        const ty = grid.y + Math.floor(cell[0] / COLS) * step;
        const delay = ((cell[0] % COLS) / COLS) * 0.6 + dot.jitter * 0.6;
        const here = ease((t - 1.4 - delay) / 1.8) * (1 - ease((t - 9.0 - dot.jitter * 0.5) / 1.4));
        const shimmer = t > 4 && t < 9 ? 0.08 * Math.sin(t * 2.4 - (cell[0] % COLS) / 6) : 0;
        x += (tx - x) * here;
        y += (ty - y) * here;
        alpha += (Math.min(1, cell[1] + shimmer) - alpha) * here;
        size += (step * 0.55 - size) * here;
      }
      if (pointer) {
        const d = Math.hypot(x - pointer.x, y - pointer.y) || 1;
        const push = Math.max(0, 1 - d / 80);
        x += ((x - pointer.x) / d) * push * push * 14;
        y += ((y - pointer.y) / d) * push * push * 14;
        alpha = Math.min(1, alpha + push * 0.4);
      }
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, y, size, size);
    }

    const shown = ease((t - 3.8) / 0.5) * (1 - ease((t - 8.8) / 0.4));
    if (shown > 0) {
      ctx.globalAlpha = shown;
      for (const [c, r] of moving(app, Math.max(0, Math.min(1, (t - 3.8) / 4.8)))) ctx.fillRect(grid.x + c * step, grid.y + r * step, step * 0.55, step * 0.55);
    }

    const typing = ease(Math.min(1, t / 1.3));
    const fade = still ? 1 : Math.max(0, Math.min(1, t / 0.3, (cycle - t) / 0.5));
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = muted;
    ctx.globalAlpha = fade;
    const typed = `> ${app.prompt.slice(0, Math.round(app.prompt.length * typing))}`;
    ctx.fillText(typed, grid.x, grid.y - 18);
    if (t < 1.5 && Math.floor(now / 450) % 2 === 0) ctx.fillRect(grid.x + ctx.measureText(typed).width + 2, grid.y - 28, 6, 13);
    if (t > 4 && t < 10) {
      const below = grid.y + ROWS * step + 26;
      ctx.globalAlpha = Math.min(1, (t - 4) / 0.4, (10 - t) / 0.4);
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
  const pad = width < 420 ? 14 : 24;
  const cols = Math.floor((width - pad * 2) / cw);
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
    ctx.fillText(value, pad + col * cw, top + row * line);
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

function term(ctx, width, height) {
  const size = width < 420 ? 10 : 11;
  ctx.font = `500 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "top";
  const cw = ctx.measureText("M").width;
  const line = Math.round(size * 1.8);
  const pad = width < 420 ? 14 : 24;
  const cols = Math.floor((width - pad * 2) / cw);
  const rows = Math.floor((height - pad * 2) / line);
  const ink = { brand: brand(), muted: css("--muted-foreground", "#777"), green: css("--success", "#16a34a"), fg: css("--foreground", "#111") };
  const text = (value, col, row, alpha = 1, fill = ink.fg) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = fill;
    ctx.fillText(value, pad + col * cw, pad + row * line);
  };
  const clear = () => {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
  };
  const glyph = (seed, moving, now) => {
    const n = Math.sin(seed * 12.9898 + (moving ? Math.floor(now / 140) : 0) * 78.233) * 43758.5453;
    const v = n - Math.floor(n);
    return { char: "#=N@%"[Math.floor(v * 5)], v };
  };
  return { cw, line, cols, rows, pad, text, clear, glyph, ...ink };
}

function clock(ms, cycle, end) {
  const t = still ? end : (ms / 1000) % cycle;
  return { t, fade: still ? 1 : Math.min(1, t / 0.3, (cycle - t) / 0.6) };
}

const spinner = (ms) => "|/-\\"[Math.floor(ms / 120) % 4];

function ask(ctx, width, height) {
  const k = term(ctx, width, height);
  const prompt = "Build a todo app where I can edit and delete items";
  const words = prompt.split(" ");
  const lines = [""];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if ((last + " " + word).trim().length > k.cols - 2) lines.push(word);
    else lines[lines.length - 1] = (last + " " + word).trim();
  }
  const plan = [
    ["todo list", "add, show and complete items"],
    ["edit items", "change an item's text"],
    ["delete items", "remove an item"],
  ];
  return (ms) => {
    const { t, fade } = clock(ms, 10, 9);
    k.clear();
    let typed = Math.floor(t * 20);
    lines.forEach((value, row) => {
      const shown = value.slice(0, Math.max(0, typed));
      typed -= value.length + 1;
      k.text(row ? "  " : "> ", 0, row, fade * 0.6, k.muted);
      k.text(shown, 2, row, fade);
    });
    const done = prompt.length / 20;
    if (t < done + 0.3) k.text(Math.floor(ms / 500) % 2 ? "_" : "", 2 + (lines[lines.length - 1] ?? "").length, lines.length - 1, fade, k.brand);
    const base = lines.length + 1;
    if (t > done + 0.4) {
      const ready = t > done + 1.6;
      k.text(ready ? "\u25cf" : spinner(ms), 0, base, fade, ready ? k.green : k.brand);
      k.text(ready ? "spec ready" : "planner is writing the spec", 2, base, fade * 0.8, k.muted);
    }
    const wide = Math.min(14, Math.floor(k.cols * 0.35));
    plan.forEach(([name, what], index) => {
      const at = done + 1.8 + index * 0.45;
      if (t < at) return;
      const a = fade * Math.min(1, (t - at) * 3);
      k.text("+", 0, base + 2 + index, a, k.brand);
      k.text(name, 2, base + 2 + index, a);
      k.text(what.slice(0, k.cols - wide - 2), 2 + wide, base + 2 + index, a * 0.7, k.muted);
    });
    const tests = done + 3.4;
    if (t > tests) {
      const a = fade * Math.min(1, (t - tests) * 3);
      const count = Math.min(9, Math.floor((t - tests) * 12));
      k.text("tests", 0, base + 6, a, k.brand);
      k.text(`${count} written, failing until built`.slice(0, k.cols - 8), 8, base + 6, a * 0.8, k.muted);
    }
    ctx.globalAlpha = 1;
  };
}

function build(ctx, width, height) {
  const k = term(ctx, width, height);
  const boxes = [
    { name: "edit items", url: "edit-items.preview", start: 0.3, build: 3.0 },
    { name: "delete items", url: "delete-items.preview", start: 0.5, build: 3.6 },
    { name: "dark mode", url: "dark-mode.preview", start: 0.7, build: 4.2, naps: true },
  ];
  const gap = 2;
  const bw = Math.floor((k.cols - gap * 2) / 3);
  const bh = Math.max(5, Math.min(9, k.rows - 6));
  return (ms) => {
    const { t, fade } = clock(ms, 12, 6);
    k.clear();
    k.text("3 sessions, 3 forks, 3 sandboxes", 0, 0, fade * 0.7, k.muted);
    boxes.forEach((box, index) => {
      const x = index * (bw + gap);
      const progress = Math.min(1, Math.max(0, (t - box.start) / box.build));
      const ready = progress >= 1;
      const asleep = box.naps && t > 8 && t < 10;
      const waking = box.naps && t >= 10 && t < 10.8;
      const edge = ready && !asleep ? k.brand : k.muted;
      const alpha = fade * (asleep ? 0.35 : 1);
      k.text("+" + "-".repeat(bw - 2) + "+", x, 2, alpha * (ready ? 0.9 : 0.5), edge);
      k.text("+" + "-".repeat(bw - 2) + "+", x, 3 + bh, alpha * (ready ? 0.9 : 0.5), edge);
      for (let r = 0; r < bh; r++) {
        k.text("|", x, 3 + r, alpha * (ready ? 0.9 : 0.5), edge);
        k.text("|", x + bw - 1, 3 + r, alpha * (ready ? 0.9 : 0.5), edge);
        const level = bh - 1 - r;
        if (level >= Math.round(progress * bh)) continue;
        for (let c = 1; c < bw - 1; c++) {
          const g = k.glyph(index * 997 + r * 61 + c, !ready || waking, ms);
          k.text(g.char, x + c, 3 + r, alpha * (0.3 + 0.5 * g.v), k.brand);
        }
      }
      k.text(box.name.slice(0, bw), x, 5 + bh, alpha);
      const link = box.url.length <= bw ? box.url : "preview ready";
      const status = asleep ? "zz sleeping" : waking ? `${spinner(ms)} waking` : ready ? link : `${spinner(ms)} ${Math.round(progress * 100)}%`;
      k.text(status.slice(0, bw), x, 6 + bh, fade * (ready && !asleep ? 0.9 : 0.6), ready && !asleep && !waking ? k.green : k.muted);
    });
    ctx.globalAlpha = 1;
  };
}

function check(ctx, width, height) {
  const k = term(ctx, width, height);
  const steps = [
    { name: "tests", done: "12 passed", at: 0.8, take: 1.5 },
    { name: "typecheck", done: "0 errors", at: 2.3, take: 0.9 },
    { name: "ai review", done: "approved", at: 3.2, take: 1.6 },
  ];
  const wide = 12;
  const bar = Math.max(6, Math.min(24, k.cols - wide - 16));
  return (ms) => {
    const { t, fade } = clock(ms, 10, 9);
    k.clear();
    k.text("edit items", 0, 0, fade);
    k.text("session done, checking before merge".slice(0, k.cols - 12), 12, 0, fade * 0.6, k.muted);
    steps.forEach((step, index) => {
      const row = 2 + index * 2;
      if (t < step.at - 0.4) return;
      const progress = Math.min(1, Math.max(0, (t - step.at) / step.take));
      const ok = progress >= 1;
      k.text(ok ? "[\u2713]" : `[${spinner(ms)}]`, 0, row, fade, ok ? k.green : k.brand);
      k.text(step.name, 4, row, fade);
      if (ok) k.text(step.done, 4 + wide, row, fade * 0.8, k.green);
      else {
        for (let c = 0; c < bar; c++) {
          const on = c < Math.round(progress * bar);
          const g = k.glyph(index * 131 + c, true, ms);
          k.text(on ? g.char : ".", 4 + wide + c, row, fade * (on ? 0.35 + 0.5 * g.v : 0.2), on ? k.brand : k.muted);
        }
      }
    });
    const after = [
      { at: 5.4, mark: "\u21bb", label: "fork synced with main", note: "no conflicts" },
      { at: 6.2, mark: "\u25cf", label: "merged into main", note: "a41c9e2" },
    ];
    after.forEach((item, index) => {
      if (t < item.at) return;
      const a = fade * Math.min(1, (t - item.at) * 3);
      k.text(item.mark, 1, 9 + index * 2, a, index ? k.green : k.brand);
      k.text(item.label, 4, 9 + index * 2, a);
      k.text(item.note, 4 + wide + 12, 9 + index * 2, a * 0.6, k.muted);
    });
    ctx.globalAlpha = 1;
  };
}

function live(ctx, width, height) {
  const k = term(ctx, width, height);
  const top = k.pad + k.line * 3;
  const room = { w: width - k.pad * 2, h: height - top - k.pad - k.line * 2 };
  const step = Math.min(room.w / COLS, room.h / ROWS);
  const dot = Math.max(1, step * 0.62);
  const rand = random(23);
  const noise = Array.from({ length: COLS * ROWS }, () => rand());
  const cycle = 13;
  const span = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  const smooth = (x) => x * x * (3 - 2 * x);
  const calls = [
    [0.3, "GET", "/", 200, 18],
    [3.9, "POST", "/api/items", 201, 22],
    [7.4, "PUT", "/api/items/2", 200, 15],
    [8.9, "DELETE", "/api/items/3", 204, 12],
  ];
  const actions = [[0, "loading the app"], [2.1, "adding an item"], [5.0, "editing item 2"], [8.0, "deleting item 3"]];
  return (ms) => {
    const { t, fade } = clock(ms, cycle, 11.5);
    k.clear();
    const paint = (c0, r0, w, h, kind, alpha = 1, gone = 0) => {
      if (alpha <= 0 || w <= 0) return;
      const x0 = Math.round(c0 * FINE);
      const y0 = Math.round(r0 * FINE);
      const x1 = x0 + Math.round(w * FINE);
      const y1 = y0 + Math.round(h * FINE);
      for (let c = x0; c < x1; c++) {
        for (let r = y0; r < y1; r++) {
          if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
          const edge = c === x0 || r === y0 || c === x1 - 1 || r === y1 - 1;
          if (kind === "line" && !edge) continue;
          if (kind === "soft" && !edge && (c + r) % 2) continue;
          const n = noise[r * COLS + c];
          if (gone && n < gone) continue;
          const shown = smooth(span(t, 0.3 + (r / ROWS) * 1.2 + n * 0.3, 0.6 + (r / ROWS) * 1.2 + n * 0.3));
          const value = kind === "solid" ? (edge ? 0.95 : 0.6) : kind === "line" ? 0.7 : edge ? 0.5 : 0.3;
          ctx.globalAlpha = fade * alpha * shown * value * (0.8 + 0.2 * Math.sin(ms / 900 + n * 6));
          ctx.fillRect(k.pad + c * step, top + r * step, dot, dot);
        }
      }
    };
    const blink = Math.floor(ms / 400) % 2 === 0;
    ctx.fillStyle = k.brand;
    paint(0, 0, 62, 4, "solid");
    paint(3, 7, 40, 4, "line");
    const typed = t < 3.9 ? Math.round(span(t, 2.2, 3.5) * 24) : 0;
    paint(5, 8, typed, 2, "soft");
    if (t > 2.1 && t < 3.9 && blink) paint(5 + typed, 8, 1, 2, "solid");
    paint(46, 7, 13, 4, "solid", t > 3.6 && t < 3.9 ? 0.35 : 1);
    const row = (slot, width, alpha = 1, gone = 0, lift = 0) => {
      const y = 14 + slot * 4 + lift;
      paint(3, y, 2, 2, slot === 0 ? "solid" : "line", alpha, gone);
      paint(8, y, width, 2, slot === 0 ? "soft" : "solid", alpha, gone);
    };
    row(0, 26);
    const editWidth = t < 5.4 || t > 8.4 ? (t > 8.4 ? 22 : 34) : t < 6.2 ? Math.round(34 * (1 - span(t, 5.4, 6.2))) : Math.round(22 * span(t, 6.2, 7.4));
    row(1, editWidth);
    if (t > 5.0 && t < 8.0) {
      const ring = Math.min(span(t, 5.0, 5.3), 1 - span(t, 7.6, 8.0));
      paint(1, 17, 60, 4, "line", ring * 0.8);
      if (t > 5.3 && t < 7.5 && blink) paint(8 + editWidth, 18, 1, 2, "solid");
    }
    const removed = span(t, 8.9, 9.6);
    if (removed < 1) row(2, 20, 1, removed);
    if (t > 8.0 && t < 9.6) paint(55, 22, 2, 2, "solid", span(t, 8.0, 8.3) * (t > 8.8 ? 1 - removed : 1));
    if (t > 3.9) {
      const slide = smooth(span(t, 3.9, 4.5));
      const up = smooth(span(t, 9.6, 10.3));
      row(3 - up, 30, slide, 0, (1 - slide) * 2);
    }
    paint(3, 34, 18, 1, "soft");
    let call = calls[0];
    for (const c of calls) if (t >= c[0]) call = c;
    const [at, method, path, code, time] = call;
    let action = actions[0][1];
    for (const [from, label] of actions) if (t >= from) action = label;
    const fresh = fade * Math.min(1, Math.max(0, (t - at) * 6));
    k.text("\u25cf", 0, 0, fade, k.green);
    k.text("todo.workers.dev", 2, 0, fade);
    k.text("live", Math.max(20, k.cols - 4), 0, fade * 0.9, k.green);
    k.text(`${t < 1.8 ? spinner(ms) : ">"} ${action}`.slice(0, k.cols), 0, 1, fade * 0.7, k.muted);
    const line = Math.floor((height - k.pad) / k.line) - 1;
    k.text("12:04:" + String(10 + Math.floor(t)).padStart(2, "0"), 0, line, fresh * 0.5, k.muted);
    k.text(method, 10, line, fresh, k.brand);
    k.text(path.slice(0, Math.max(4, k.cols - 31)), 17, line, fresh);
    if (k.cols > 34) {
      k.text(String(code), k.cols - 10, line, fresh, k.green);
      k.text(`${time}ms`, k.cols - 5, line, fresh * 0.6, k.muted);
    }
    ctx.globalAlpha = 1;
  };
}

const storyScenes = { ask, tree, build, check, live };
const storyLabels = { ask: "01 ask", tree: "02 split", build: "03 build", check: "04 check", live: "05 live" };
let storyStep = "ask";

function story(ctx, width, height) {
  let current = null;
  let scene = null;
  let start = 0;
  let last = 0;
  return (now) => {
    if (now - last > 400) start = now - (last - start);
    last = now;
    if (current !== storyStep) {
      current = storyStep;
      scene = storyScenes[current](ctx, width, height);
      start = now;
    }
    scene(now - start);
  };
}

const steps = document.querySelectorAll("[data-step]");
const showStep = (name) => {
  if (!storyScenes[name] || (name === storyStep && document.querySelector(".step.on"))) return;
  storyStep = name;
  steps.forEach((step) => step.classList.toggle("on", step.dataset.step === name));
  const label = document.querySelector("[data-story-label]");
  if (label) label.textContent = storyLabels[name];
  document.querySelectorAll("[data-story]").forEach((canvas) => canvas.redraw?.());
};
let picking = 0;
const pickStep = () => {
  picking = 0;
  if (!steps.length) return;
  const line = window.innerHeight * 0.55;
  let current = steps[0];
  for (const step of steps) if (step.getBoundingClientRect().top <= line) current = step;
  showStep(current.dataset.step);
};
const queuePick = () => {
  if (!picking) picking = requestAnimationFrame(pickStep);
};
window.addEventListener("scroll", queuePick, { passive: true });
window.addEventListener("resize", queuePick);
pickStep();

const scenes = { city, mark, showcase, dots, story };
for (const [name, setup] of Object.entries(scenes)) {
  document.querySelectorAll(`[data-${name}]`).forEach((canvas) => animate(canvas, setup));
}
