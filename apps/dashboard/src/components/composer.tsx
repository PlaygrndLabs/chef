import { useEffect, useState, type Ref } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Composer({
  placeholder,
  hint,
  onSend,
  draft,
  ref,
  id,
}: {
  readonly placeholder: string;
  readonly hint?: string;
  readonly onSend: (text: string) => Promise<boolean> | boolean;
  readonly draft?: { readonly text: string; readonly n: number } | null;
  readonly ref?: Ref<HTMLTextAreaElement>;
  readonly id?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (draft) setText(draft.text);
  }, [draft]);
  const submit = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      if (await onSend(value)) setText("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="px-4 pt-2 pb-4 sm:px-6 sm:pb-5" id={id}>
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring/30">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="block max-h-48 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{hint}</span>
          <Button size="icon" className="rounded-xl" onClick={() => void submit()} disabled={!text.trim() || sending} aria-label="Send">
            {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </div>
  );
}
