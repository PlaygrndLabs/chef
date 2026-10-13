import { useState } from "react";
import { cn } from "@/lib/utils";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function read(key: string, initial: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : initial;
  } catch {
    return initial;
  }
}

export function useStoredWidth(key: string, initial: number): readonly [number, (width: number) => void] {
  const [width, setWidth] = useState(() => read(key, initial));
  const save = (next: number) => {
    setWidth(next);
    try {
      localStorage.setItem(key, String(Math.round(next)));
    } catch {
      return;
    }
  };
  return [width, save];
}

export function ResizeHandle(props: { readonly edge: "left" | "right"; readonly width: number; readonly min: number; readonly max: number; readonly initial: number; readonly onResize: (width: number) => void; readonly label: string }) {
  const { edge, width, min, max, initial, onResize, label } = props;
  const [dragging, setDragging] = useState(false);
  const sign = edge === "left" ? -1 : 1;
  const start = (event: React.PointerEvent) => {
    event.preventDefault();
    const x = event.clientX;
    const from = width;
    setDragging(true);
    const move = (e: PointerEvent) => onResize(clamp(from + sign * (e.clientX - x), min, max));
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const key = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") onResize(clamp(width - sign * step, min, max));
    else if (event.key === "ArrowRight") onResize(clamp(width + sign * step, min, max));
    else return;
    event.preventDefault();
  };
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={Math.round(width)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={start}
        onKeyDown={key}
        onDoubleClick={() => onResize(initial)}
        className={cn("group absolute inset-y-0 z-20 w-2 cursor-col-resize outline-none", edge === "left" ? "-left-1" : "-right-1")}
      >
        <span className={cn("absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring", dragging && "bg-ring")} />
      </div>
      {dragging ? <div className="fixed inset-0 z-50 cursor-col-resize" /> : null}
    </>
  );
}
