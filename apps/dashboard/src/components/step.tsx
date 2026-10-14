import type { ReactNode } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "wait" | "run" | "done" | "failed";

export function Step(props: { readonly state: StepState; readonly took?: string | null; readonly children: ReactNode }) {
  return (
    <li className={cn("flex items-start gap-2.5 text-sm", props.state === "wait" && "text-muted-foreground")} data-step={props.state}>
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
        {props.state === "run" ? <Loader2 className="size-4 animate-spin" /> : props.state === "done" ? <Check className="size-4 text-ok" /> : props.state === "failed" ? <CircleAlert className="size-4 text-bad" /> : <span className="size-1.5 rounded-full bg-muted-foreground/50" />}
      </span>
      <span className="min-w-0 flex-1">{props.children}</span>
      {props.took ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{props.took}</span> : null}
    </li>
  );
}
