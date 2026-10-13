import { useEffect, useRef, useState, type PointerEvent } from "react";
import { AudioLines, Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { clampSpot, saveSpot, savedSpot, useTalkButton, type TalkSpot } from "@/lib/talk";
import { startTalk, transcript, type Heard } from "@/lib/voice";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const SIZE = 56;
const MOVE = 4;

const STATUS: Readonly<Record<string, string>> = {
  starting: "Starting",
  connecting: "Connecting",
  listening: "Listening",
  closing: "Stopping",
};

interface Drag {
  readonly x: number;
  readonly y: number;
  readonly start: TalkSpot;
  moved: boolean;
}

export function TalkButton() {
  const { selection } = useWorkspace();
  const [shown] = useTalkButton();
  const [status, setStatus] = useState("off");
  const [heard, setHeard] = useState<Heard[]>([]);
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState(savedSpot);
  const [dragging, setDragging] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);
  const stop = useRef<(() => Promise<void>) | null>(null);
  const on = status !== "off";
  const listening = status === "listening";
  const visible = shown || on;

  const area = () => {
    const parent = button.current?.offsetParent;
    return parent instanceof HTMLElement ? { width: parent.clientWidth, height: parent.clientHeight } : null;
  };

  useEffect(() => {
    if (!visible) return;
    const fit = () => {
      const size = area();
      if (size) setSpot((current) => clampSpot(current, size, SIZE));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [visible]);

  const toggle = async () => {
    if (stop.current) {
      const end = stop.current;
      stop.current = null;
      setStatus("closing");
      await end();
      return;
    }
    setHeard([]);
    setOpen(true);
    setStatus("starting");
    try {
      stop.current = await startTalk({ project: selection.project, onStatus: setStatus, onEvent: (event) => setHeard((lines) => transcript(lines, event)) });
    } catch (error) {
      setStatus("off");
      toast.error("Voice did not start", { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const moveTo = (e: PointerEvent, d: Drag) => {
    const size = area();
    return size ? clampSpot({ right: d.start.right - (e.clientX - d.x), bottom: d.start.bottom - (e.clientY - d.y) }, size, SIZE) : d.start;
  };
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, start: spot, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < MOVE) return;
    d.moved = true;
    setDragging(true);
    setSpot(moveTo(e, d));
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    dragged.current = true;
    setDragging(false);
    const next = moveTo(e, d);
    setSpot(next);
    saveSpot(next);
  };
  const click = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    void toggle();
  };

  if (!visible) return null;
  const label = on ? "Stop talking" : "Talk to chef";
  return (
    <Popover open={open && on} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          ref={button}
          type="button"
          id="talk-button"
          data-status={status}
          aria-label={label}
          title={`${label}. Drag to move.`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onClick={click}
          style={{ right: spot.right, bottom: spot.bottom, width: SIZE, height: SIZE }}
          className={cn(
            "group absolute z-20 grid touch-none place-items-center rounded-full shadow-lg ring-1 ring-black/10 transition-[transform,box-shadow,background-color] outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/50 dark:ring-white/15",
            on ? "bg-run text-white" : "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl",
            dragging ? "scale-110 cursor-grabbing shadow-2xl" : "cursor-grab active:cursor-grabbing",
          )}
        >
          {listening ? <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-run/40" aria-hidden /> : null}
          <span className="pointer-events-none absolute inset-1 rounded-full bg-gradient-to-b from-white/20 to-transparent" aria-hidden />
          {status === "starting" || status === "connecting" || status === "closing" ? (
            <Loader2 className="relative size-6 animate-spin" />
          ) : listening ? (
            <>
              <AudioLines className="relative size-6 group-hover:hidden" />
              <Square className="relative hidden size-5 fill-current group-hover:block" />
            </>
          ) : (
            <Mic className="relative size-6" />
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent side="top" align="end" sideOffset={12} className="w-80 gap-0 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <span className={cn("size-2 rounded-full", listening ? "animate-pulse bg-run" : "bg-muted-foreground")} aria-hidden />
          <span className="flex-1 text-sm font-medium">{STATUS[status] ?? "Voice"}</span>
          <Button size="xs" variant="outline" onClick={() => void toggle()}>
            <Square className="fill-current" />
            Stop
          </Button>
        </div>
        <div className="flex max-h-64 flex-col gap-2 overflow-auto p-3 text-sm" aria-live="polite">
          {heard.length === 0 ? <p className="text-muted-foreground">Say what you want built or changed.</p> : null}
          {heard.map((line, i) => (
            <p key={i} className={cn("max-w-[85%] rounded-2xl px-3 py-1.5", line.speaker === "you" ? "self-end bg-muted" : "self-start border")}>
              {line.text}
            </p>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
