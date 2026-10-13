import { CHAT_CONTEXT_TOKENS, featureList, tokensOf } from "@chef/core/chat";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

function thousands(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
}

export function ContextMeter() {
  const { data } = useWorkspace();
  if (!data.ready) return null;
  const context = data.live.context ?? { used: tokensOf(featureList(data.spec?.features ?? [])), limit: CHAT_CONTEXT_TOKENS, turns: 0, dropped: 0 };
  const share = Math.min(1, context.used / context.limit);
  const about = `chef sends the feature list and your last ${context.turns === 1 ? "message" : `${context.turns} messages`} with each new one: ${context.used.toLocaleString()} of ${context.limit.toLocaleString()} tokens. ${context.dropped ? `${context.dropped} older ${context.dropped === 1 ? "message no longer fits" : "messages no longer fit"}.` : "The oldest messages drop off once it is full."}`;
  return (
    <div className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground" id="chat-context" title={about} aria-label={about}>
      <span>Context</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-full bg-foreground/50", share > 0.9 && "bg-bad")} style={{ width: `${Math.max(2, share * 100)}%` }} />
      </span>
      <span className="font-mono tabular-nums">
        {thousands(context.used)} / {thousands(context.limit)}
      </span>
    </div>
  );
}
