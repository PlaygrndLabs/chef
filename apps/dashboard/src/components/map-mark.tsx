import type { Tone } from "@/lib/format";
import type { MapMark } from "@/lib/model";
import { cn } from "@/lib/utils";

const PIXELS: Readonly<Record<MapMark, readonly string[]>> = {
  current: [
    ".#.........",
    ".#######...",
    ".########..",
    ".#######...",
    ".######....",
    ".#.........",
    ".#.........",
    ".#.........",
    ".#.........",
    "###........",
  ],
  wish: [
    "....##......",
    "...####.....",
    ".#########.#",
    "#.########.#",
    "#.#########.",
    ".##########.",
    "..########..",
    "....####....",
    "...######...",
  ],
  working: [
    "############",
    ".##.#....#..",
    ".###.....#..",
    ".##......#..",
    ".##.....###.",
    ".##.....#.#.",
    ".##.........",
    ".##.........",
    ".##.........",
    "####........",
  ],
};

export const MARK_LABEL: Readonly<Record<MapMark, string>> = { current: "In the code", wish: "Wish", working: "Being built" };

const SIZE = 12;

const TONE: Readonly<Record<Tone, string>> = { run: "text-run blink-run", ok: "text-ok", bad: "text-bad", idle: "text-muted-foreground", gone: "text-muted-foreground/60" };

export function MapMarkIcon({ mark, tone, className }: { readonly mark: MapMark; readonly tone?: Tone | null; readonly className?: string }) {
  const rows = PIXELS[mark];
  const color = tone ? TONE[tone] : mark === "working" ? TONE.run : mark === "wish" ? "text-brand" : "text-muted-foreground";
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" data-mark={mark} className={cn("size-3.5 shrink-0", color, className)} shapeRendering="crispEdges">
      {rows.flatMap((row, y) => [...row].map((cell, x) => (cell === "#" ? <rect key={`${x}-${y}`} x={x} y={y + 1} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}
