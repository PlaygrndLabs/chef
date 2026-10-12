import { useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { startTalk, transcript, type Heard } from "@/lib/voice";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export function VoiceButton({ compact = false }: { readonly compact?: boolean }) {
  const { selection } = useWorkspace();
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
  return (
    <Popover open={open && on} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={on ? "secondary" : compact ? "ghost" : "outline"} size={compact ? "icon" : "sm"} onClick={() => void toggle()} aria-label={on ? "Stop talking" : "Talk to chef"} className={cn(on && "text-run")}>
          {on ? <MicOff /> : <Mic />}
          {compact ? null : on ? "Stop" : "Talk"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
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
