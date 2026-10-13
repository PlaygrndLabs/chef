import { useEffect, useRef } from "react";
import { BLUE } from "@chef/core/brand";
import type { Levels } from "@/lib/voice";
import { cn } from "@/lib/utils";

const PITCH = 6;
const EDGE = [120, 162, 255] as const;
const NIGHT_CORE = [58, 118, 255] as const;
const NIGHT_EDGE = [156, 190, 255] as const;
const MUTED = [148, 155, 168] as const;

function rgb(hex: string): readonly [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hash(i: number, j: number): number {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function mix(a: readonly number[], b: readonly number[], t: number): string {
  const c = a.map((v, k) => Math.round(v + ((b[k] ?? v) - v) * t));
  return `${c[0]},${c[1]},${c[2]}`;
}

export function PixelOrb({ size, waiting, muted, levels, className }: { readonly size: number; readonly waiting: boolean; readonly muted: boolean; readonly levels: () => Levels; readonly className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const props = useRef({ waiting, muted, levels });
  props.current = { waiting, muted, levels };

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    element.width = size * ratio;
    element.height = size * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const core = rgb(BLUE);
    const cells = Math.floor(size / PITCH);
    const offset = (size - cells * PITCH) / 2;
    const center = size / 2;
    const base = size * 0.29;
    let amp = 0;
    let frame = 0;
    const started = performance.now();

    const draw = (now: number) => {
      const { waiting: idle, muted: quiet, levels: read } = props.current;
      const t = ((now - started) / 1000) * (calm ? 0.25 : 1);
      const heard = read();
      const target = idle ? 0.12 + 0.08 * Math.sin(t * 2.4) : Math.max(heard.chef, quiet ? 0 : heard.you);
      amp += (target - amp) * (target > amp ? 0.35 : 0.08);
      const night = document.documentElement.classList.contains("dark");
      const gray = quiet && heard.chef < 0.03;
      const edge = gray ? MUTED : night ? NIGHT_EDGE : EDGE;
      const deep = gray ? MUTED : night ? NIGHT_CORE : core;
      context.clearRect(0, 0, size, size);
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          const x = offset + i * PITCH + PITCH / 2;
          const y = offset + j * PITCH + PITCH / 2;
          const dx = x - center;
          const dy = y - center;
          const d = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          const wobble = 0.06 * Math.sin(3 * a + 1.1 * t) + 0.05 * Math.sin(5 * a - 0.7 * t + 1.3) + 0.03 * Math.sin(2 * a + 0.5 * t);
          const r = base * (1 + wobble) * (1 + 0.32 * amp) + base * 0.14 * amp * Math.sin(7 * a + 4 * t);
          const h = hash(i, j);
          const twinkle = calm ? 1 : 0.82 + 0.18 * Math.sin(t * 3 + h * 20);
          if (d < r) {
            const depth = 1 - d / r;
            const band = 0.5 + 0.5 * Math.sin((dx - dy) * 0.06 - t * 1.6);
            const shade = Math.min(1, Math.pow(1 - depth, 2) * 0.95 + band * 0.1);
            const alpha = Math.min(1, (0.55 + 0.45 * Math.sqrt(depth)) * twinkle * (idle ? 0.7 : 1) * (night ? 1.2 : 1));
            const side = PITCH * (0.55 + 0.3 * Math.min(1, depth * 3));
            context.fillStyle = `rgba(${mix(deep, edge, shade)},${alpha.toFixed(3)})`;
            context.fillRect(x - side / 2, y - side / 2, side, side);
          } else if (d < r * 1.55) {
            const out = (d - r) / (r * 0.55);
            const shown = Math.sin(t * 1.4 + h * 40) > 0.55 - amp * 0.7;
            if (!shown || h > 0.18 + amp * 0.3) continue;
            const alpha = (1 - out) * 0.55 * twinkle;
            const side = PITCH * 0.42;
            context.fillStyle = `rgba(${mix(deep, edge, 0.8)},${alpha.toFixed(3)})`;
            context.fillRect(x - side / 2, y - side / 2, side, side);
          }
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return <canvas ref={canvas} aria-hidden data-orb="" style={{ width: size, height: size }} className={cn("block", className)} />;
}
