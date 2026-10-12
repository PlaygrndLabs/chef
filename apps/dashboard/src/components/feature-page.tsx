import { useEffect, useRef, useState, type Ref } from "react";
import { AlertTriangle, Check, ChevronDown, Code2, FlaskConical, GitMerge, ListChecks, Loader2, MessageSquareText, MoreHorizontal, OctagonX, PanelRight, RotateCcw, Rocket, ShieldCheck, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Composer } from "@/components/composer";
import { StatusPill } from "@/components/status";
import { isActive } from "@/lib/events";
import { clock, STATE_LABEL } from "@/lib/format";
import type { FeatureNode, SessionNode } from "@/lib/model";
import { progress, STAGES, updates, type Update, type UpdateIcon, type UpdateTone } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const ICONS: Readonly<Record<UpdateIcon, typeof Check>> = { plan: ListChecks, test: FlaskConical, code: Code2, review: MessageSquareText, check: ShieldCheck, live: Rocket, alert: AlertTriangle, stop: OctagonX, sync: GitMerge, pick: Trophy };
const TONE: Readonly<Record<UpdateTone, string>> = { ok: "text-ok", run: "text-run", bad: "text-bad", idle: "text-muted-foreground" };

export function currentSession(feature: FeatureNode, selected: string | null): SessionNode | null {
  const chosen = selected ? feature.sessions.find((s) => s.id === selected) : undefined;
  if (chosen) return chosen;
  return [...feature.sessions].reverse().find((s) => s.state !== "dropped") ?? feature.sessions.at(-1) ?? null;
}

function Steps({ node }: { readonly node: SessionNode }) {
  const p = progress(node.state, node.live?.timeline ?? []);
  return (
    <ol className="flex items-center gap-1.5 overflow-x-auto" aria-label="Progress">
      {STAGES.map((name, i) => {
        const done = p.done || i < p.stage;
        const now = !p.done && i === p.stage;
        const failed = now && p.failed;
        const running = now && !p.failed && !p.stopped;
        return (
          <li key={name} className="flex shrink-0 items-center gap-1.5" aria-current={now ? "step" : undefined}>
            {i > 0 ? <span className={cn("h-px w-3 sm:w-8", done ? "bg-ok" : "bg-border")} /> : null}
            <span className={cn("grid size-5 place-items-center rounded-full border-[1.5px]", done && "border-ok bg-ok text-background", running && "border-run", failed && "border-bad bg-bad text-background")}>
              {done ? <Check className="size-3" strokeWidth={3.5} /> : failed ? <X className="size-3" strokeWidth={3.5} /> : running ? <span className="pulse-run size-2 rounded-full bg-run" /> : null}
            </span>
            <span className={cn("text-sm text-muted-foreground", !now && "max-sm:sr-only", done && "text-foreground", running && "font-medium text-run", failed && "font-medium text-bad")}>{name}</span>
          </li>
        );
      })}
    </ol>
  );
}

function UpdateRow({ update }: { readonly update: Update }) {
  const [open, setOpen] = useState(false);
  if (update.kind === "you")
    return (
      <div className="flex max-w-[80%] flex-col items-end gap-0.5 self-end">
        {update.note ? <span className="text-xs text-muted-foreground">Your note for the next step</span> : null}
        <div className="rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[15px] whitespace-pre-wrap">{update.text}</div>
      </div>
    );
  const Icon = ICONS[update.icon];
  return (
    <div className="flex gap-3" data-review={update.mark.review} data-gate={update.mark.gate} data-tone={update.tone}>
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-muted", TONE[update.tone])}>{update.tone === "run" ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}</span>
      <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 flex-1 pt-0.5">
        <div className="text-[15px]">{update.text}</div>
        {update.detail ? <div className="truncate text-sm text-muted-foreground">{update.detail}</div> : null}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{clock(update.at)}</span>
          {update.tech.length ? (
            <CollapsibleTrigger className="inline-flex items-center gap-0.5 hover:text-foreground">
              {open ? "Hide details" : "Details"}
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

function NeedsYou({ node }: { readonly node: SessionNode }) {
  const { api, data } = useWorkspace();
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const feedback = node.record?.machine.feedback;
  const retry = async () => {
    setBusy(true);
    try {
      await api.retry(node.id, guidance.trim());
      toast.success("kargah is trying again");
      setGuidance("");
      data.refresh();
    } catch (error) {
      toast.error("Could not try again", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-bad/30 bg-bad/5 p-4" data-needs-you={node.id}>
      <div className="font-semibold text-bad">kargah needs your help</div>
      <p>{node.live?.stuck ?? node.record?.machine.reason ?? "It stopped before finishing."}</p>
      {feedback ? (
        <Collapsible>
          <CollapsibleTrigger className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
            What failed
            <ChevronDown className="size-3" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-background p-3 font-mono text-xs whitespace-pre-wrap">{feedback}</pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <Textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={3} placeholder="Tell kargah what to do differently" aria-label="Tell kargah what to do differently" className="bg-background" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void retry()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Try again
        </Button>
        <Button variant="ghost" onClick={() => setStopping(true)}>
          Stop this feature
        </Button>
      </div>
      <StopDialog node={node} open={stopping} onOpenChange={setStopping} />
    </div>
  );
}

function StopDialog({ node, open, onOpenChange }: { readonly node: SessionNode; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { api, data } = useWorkspace();
  const stop = async () => {
    try {
      await api.drop(node.id, "stopped by a person");
      toast.success(isActive(node.state) ? "Stopping after the current step" : "Stopped");
      data.refresh();
    } catch (error) {
      toast.error("Could not stop it", { description: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop building this?</AlertDialogTitle>
          <AlertDialogDescription>kargah stops working on it and nothing goes live. The work so far is kept, and you can start over later.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep going</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void stop()}>
            Stop building
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FeaturePage({ feature, composerRef }: { readonly feature: FeatureNode; readonly composerRef: Ref<HTMLTextAreaElement> }) {
  const { api, data, selection, select, openSession } = useWorkspace();
  const node = currentSession(feature, selection.session);
  const [stopping, setStopping] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const timeline = node?.live?.timeline ?? [];
  const list = node ? updates(timeline, node.state, node.record ? { prompt: node.record.rootPrompt, at: node.record.createdAt } : undefined) : [];
  const p = node ? progress(node.state, timeline) : null;
  const active = node ? isActive(node.state) : false;
  const attempts = node ? feature.sessions.filter((s) => s.record?.attempt.group === node.record?.attempt.group || s.id === node.id) : [];
  const preview = node?.live?.preview ?? node?.record?.preview ?? feature.preview;
  const panel = selection.panel;
  const criteria = feature.spec?.acceptance ?? [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [list.length, node?.id]);

  const startOver = async () => {
    try {
      const result = await api.prompt(`#${feature.id} ${node?.record?.rootPrompt ?? feature.title}`);
      toast.success("Started over");
      data.refresh();
      if (result.sessionId) openSession(result.sessionId);
    } catch (error) {
      toast.error("Could not start over", { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const send = async (text: string) => {
    try {
      if (node && active) {
        await api.steer(node.id, text);
        toast.success("kargah reads your note on its next step");
      } else if (node?.state === "stuck") {
        await api.retry(node.id, text);
        toast.success("kargah is trying again with your note");
      } else {
        const result = await api.prompt(`#${feature.id} ${text}`);
        toast.success("kargah started on your change");
        if (result.sessionId) openSession(result.sessionId);
      }
      data.refresh();
      return true;
    } catch (error) {
      toast.error("Not sent", { description: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-view="feature" data-feature={feature.id} data-session={node?.id} data-state={node?.state}>
      <header className="flex h-15 shrink-0 items-center gap-2.5 border-b px-4 sm:px-6">
        <h1 className="min-w-0 truncate text-base font-semibold">{feature.title}</h1>
        <StatusPill status={feature.status} />
        <span className="flex-1" />
        {preview ? (
          <Button variant={panel ? "outline" : "default"} size="sm" onClick={() => select({ panel: panel ? null : "preview" })}>
            <PanelRight />
            {panel ? "Hide preview" : "Preview"}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={() => select({ panel: "changes" })} disabled={!node}>
              Show changes and details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void startOver()}>Start over</DropdownMenuItem>
            {node && (active || node.state === "stuck") ? (
              <DropdownMenuItem variant="destructive" onClick={() => setStopping(true)}>
                Stop building
              </DropdownMenuItem>
            ) : null}
            {feature.sessions.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Builds of this feature</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={node?.id ?? ""} onValueChange={(id) => openSession(id)}>
                  {[...feature.sessions].reverse().map((s, i) => (
                    <DropdownMenuRadioItem key={s.id} value={s.id}>
                      {i === 0 ? "Latest" : `Earlier build ${feature.sessions.length - i}`}
                      <span className="ml-auto text-xs text-muted-foreground">{STATE_LABEL[s.state]}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-7 sm:px-6">
          {node && p ? (
            <div className="flex flex-col gap-3 rounded-2xl border p-4">
              <Steps node={node} />
              <p>{p.now}</p>
              {attempts.length > 1 ? <p className="text-sm text-muted-foreground">kargah is trying {attempts.length} approaches at once and keeps the one that passes the most tests.</p> : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-2xl border p-4">
              <p>kargah has not built this yet.</p>
              {feature.spec?.body ? <p className="text-muted-foreground">{feature.spec.body}</p> : null}
              <p className="text-sm text-muted-foreground">Describe what you want below and it starts.</p>
            </div>
          )}
          {node?.state === "stuck" ? <NeedsYou node={node} /> : null}
          {feature.status === "merged" && criteria.length ? (
            <section className="flex flex-col gap-2.5">
              <h2 className="text-xs font-medium text-muted-foreground">What it does</h2>
              <ul className="flex flex-col gap-2">
                {criteria.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <Check className="mt-1 size-4 shrink-0 text-ok" strokeWidth={2.6} />
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {list.map((u) => (
            <UpdateRow key={u.key} update={u} />
          ))}
          <div ref={end} />
        </div>
      </div>
      <Composer
        ref={composerRef}
        key={node?.id ?? feature.id}
        placeholder={active ? "Add a note. kargah reads it on its next step" : node?.state === "stuck" ? "Or reply here with a hint" : `Ask for a change to ${feature.title}`}
        hint={active ? "Your note does not restart the work" : node?.state === "stuck" ? "Sending tries again with your hint" : "Starts a new build of this feature"}
        onSend={send}
      />
      {node ? <StopDialog node={node} open={stopping} onOpenChange={setStopping} /> : null}
    </div>
  );
}
