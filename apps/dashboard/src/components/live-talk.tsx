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
    let quiet = 4;
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
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 px-4 pt-3 pb-1">
        <PixelOrb size={132} waiting={waiting} muted={talk.muted} levels={levels} />
        <p className={cn("text-sm", talking ? "text-foreground" : "text-muted-foreground")} aria-live="polite" id="live-status">
          {label}
        </p>
        <div className="mt-1 flex items-start gap-6">
          <div className="flex flex-col items-center gap-1">
            <Button variant="secondary" size="icon" className={cn("size-11 rounded-full", talk.muted && "bg-bad/15 text-bad hover:bg-bad/20")} onClick={() => setMuted(!talk.muted)} disabled={waiting} aria-pressed={talk.muted} aria-label={talk.muted ? "Unmute" : "Mute"} title={talk.muted ? "Turn your microphone back on" : "Turn your microphone off"} id="live-mute">
              {talk.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </Button>
            <span className="text-xs text-muted-foreground" aria-hidden>
              {talk.muted ? "Unmute" : "Mute"}
            </span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Button variant="secondary" size="icon" className="size-11 rounded-full" onClick={() => void endLive()} aria-label="End live talk" title="End live talk (Esc)" id="live-end">
              <X className="size-5" />
            </Button>
            <span className="text-xs text-muted-foreground" aria-hidden>
              End
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
