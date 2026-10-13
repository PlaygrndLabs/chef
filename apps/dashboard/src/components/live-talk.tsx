import { useEffect, useState } from "react";
import { Mic, MicOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixelOrb } from "@/components/pixel-orb";
import { endLive, levels, setMuted, useTalk } from "@/lib/live-talk";
import { cn } from "@/lib/utils";

const TALKING = 0.04;

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function useChefTalking(on: boolean): boolean {
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (!on) return;
    let quiet = 0;
    const timer = window.setInterval(() => {
      const loud = levels().chef > TALKING;
      quiet = loud ? 0 : quiet + 1;
      setTalking(loud || quiet < 4);
    }, 150);
    return () => {
      window.clearInterval(timer);
      setTalking(false);
    };
  }, [on]);
  return talking;
}

export function LivePanel() {
  const talk = useTalk();
  const waiting = talk.phase === "starting" || talk.phase === "connecting";
  const talking = useChefTalking(talk.phase === "listening");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !typing(e.target) && !e.defaultPrevented && !document.querySelector('[role="dialog"], [role="menu"]')) void endLive();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const label = talk.phase === "starting" ? "Starting live talk" : talk.phase === "connecting" ? "Connecting" : talking ? "chef is talking" : talk.muted ? "Muted. chef can't hear you." : "Listening";
  return (
    <div className="px-4 pt-2 pb-4 sm:px-6 sm:pb-5" id="live-talk" data-phase={talk.phase} data-muted={talk.muted}>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 rounded-2xl border bg-card px-4 pt-3 pb-4 shadow-xs">
        <PixelOrb size={132} waiting={waiting} muted={talk.muted} levels={levels} />
        <p className={cn("text-sm", talking ? "text-foreground" : "text-muted-foreground")} aria-live="polite" id="live-status">
          {label}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <Button variant="secondary" size="icon" className="size-11 rounded-full" onClick={() => setMuted(!talk.muted)} disabled={waiting} aria-pressed={talk.muted} aria-label={talk.muted ? "Unmute" : "Mute"} title={talk.muted ? "Unmute" : "Mute"} id="live-mute">
            {talk.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </Button>
          <Button variant="secondary" size="icon" className="size-11 rounded-full" onClick={() => void endLive()} aria-label="End live talk" title="End live talk (Esc)" id="live-end">
            <X className="size-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
