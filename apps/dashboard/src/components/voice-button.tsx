import { useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTalkButton } from "@/lib/talk";
import { startTalk, transcript, type Heard } from "@/lib/voice";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export function TalkButton() {
  const { selection } = useWorkspace();
  const [shown] = useTalkButton();
  const [status, setStatus] = useState("off");
  const [heard, setHeard] = useState<Heard[]>([]);
  const [open, setOpen] = useState(false);
  const stop = useRef<(() => Promise<void>) | null>(null);
  const on = status !== "off";
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
  if (!shown && !on) return null;
  return (
    <Popover open={open && on} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="talk-button"
          variant={on ? "secondary" : "outline"}
          onClick={() => void toggle()}
          aria-label={on ? "Stop talking" : "Talk to chef"}
          title={on ? "Stop talking" : "Talk to chef"}
          className={cn("absolute right-4 bottom-28 z-20 h-11 rounded-full bg-background px-4 shadow-lg md:right-6", on && "bg-secondary text-run")}
        >
          {on ? <MicOff /> : <Mic />}
          {on ? "Stop" : "Talk"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80">
        <div className="mb-2 text-xs text-muted-foreground">Voice is {status}</div>
        <div className="flex max-h-60 flex-col gap-1.5 overflow-auto text-sm">
          {heard.length === 0 ? <p className="text-muted-foreground">Say what you want built or changed.</p> : null}
          {heard.map((line, i) => (
            <p key={i}>
              <span className="text-muted-foreground">{line.speaker}: </span>
              {line.text}
            </p>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
