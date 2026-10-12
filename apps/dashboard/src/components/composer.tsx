import { useState, type Ref } from "react";
import { ArrowUp, Crosshair, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VoiceButton } from "@/components/voice-button";

export function Composer({
  placeholder,
  target,
  note,
  onSend,
  busy = false,
  ref,
  id,
}: {
  readonly placeholder: string;
  readonly target: string;
  readonly note?: string;
  readonly onSend: (text: string) => Promise<boolean> | boolean;
  readonly busy?: boolean;
  readonly ref?: Ref<HTMLTextAreaElement>;
  readonly id?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async () => {
    const value = text.trim();
    if (!value || sending || busy) return;
    setSending(true);
    try {
      if (await onSend(value)) setText("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="px-4 pt-2 pb-4" id={id}>
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring/30">
        <textarea
          ref={ref}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="block max-h-48 min-h-14 w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs">
                <Crosshair className="size-3" />
                {target}
              </span>
            </TooltipTrigger>
            <TooltipContent>Where this message goes</TooltipContent>
          </Tooltip>
          <span className="flex-1" />
          {note ? <span className="hidden text-xs text-muted-foreground sm:inline">{note}</span> : null}
          <VoiceButton compact />
          <Button size="icon" onClick={() => void submit()} disabled={!text.trim() || sending || busy} aria-label="Send">
            {sending || busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </div>
  );
}
