import { useState } from "react";
import { AlertTriangle, ChevronDown, Code2, FlaskConical, GitMerge, ListChecks, Loader2, MessageSquareText, OctagonX, ShieldCheck, Trophy } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PromptText } from "@/components/status";
import { clock } from "@/lib/format";
import type { Update, UpdateIcon, UpdateTone } from "@/lib/progress";
import { cn } from "@/lib/utils";

const ICONS: Readonly<Record<UpdateIcon, typeof GitMerge>> = { plan: ListChecks, test: FlaskConical, code: Code2, review: MessageSquareText, check: ShieldCheck, merged: GitMerge, alert: AlertTriangle, stop: OctagonX, sync: GitMerge, pick: Trophy };
const TONE: Readonly<Record<UpdateTone, string>> = { ok: "text-ok", run: "text-run", bad: "text-bad", idle: "text-muted-foreground" };

export function UpdateRow({ update, roleName }: { readonly update: Update; readonly roleName: (role: string) => string }) {
  const [open, setOpen] = useState(false);
  if (update.kind === "you")
    return (
      <div className="flex max-w-[80%] flex-col items-end gap-0.5 self-end">
        {update.note ? <span className="text-xs text-muted-foreground">Your note for the next step</span> : null}
        <div className="rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
          <PromptText text={update.text} />
        </div>
      </div>
    );
  const Icon = ICONS[update.icon];
  return (
    <div className="flex gap-3" data-review={update.mark.review} data-gate={update.mark.gate} data-tone={update.tone}>
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-muted", TONE[update.tone])}>{update.tone === "run" ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}</span>
      <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm">{update.text}</div>
        {update.detail ? <div className="truncate text-sm text-muted-foreground">{update.detail}</div> : null}
        {update.tone === "run" && !open && update.tech.length ? (
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs text-muted-foreground" data-live-actions>
            {update.tech.slice(-3).map((line, i) => (
              <li key={i} className="truncate">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{clock(update.at)}</span>
          {update.role ? <span data-update-role={update.role}>{roleName(update.role)}</span> : null}
          {update.tech.length ? (
            <CollapsibleTrigger className="inline-flex items-center gap-0.5 hover:text-foreground">
              {open ? "Hide" : `${update.tech.length} ${update.tech.length === 1 ? "action" : "actions"}`}
              <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
            </CollapsibleTrigger>
          ) : null}
        </div>
        <CollapsibleContent>
          <div className="mt-2 flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">
            {update.tech.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
