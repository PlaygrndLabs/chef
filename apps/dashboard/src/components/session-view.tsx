import { useEffect, useRef, useState, type Ref } from "react";
import type { SessionState } from "@kargah/core";
import { Check, ExternalLink, GitFork, OctagonX, RotateCcw, Route } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Composer } from "@/components/composer";
import { StateBadge } from "@/components/status";
import { Callout, Timeline } from "@/components/timeline";
import { isActive } from "@/lib/events";
import { short, stateTone, STEPS, stepIndex } from "@/lib/format";
import type { SessionNode } from "@/lib/model";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { AlertTriangle } from "lucide-react";

function failedAt(node: SessionNode): SessionState | null {
  if (node.state !== "stuck" && node.state !== "dropped") return null;
  const states = node.live?.timeline.filter((t) => t.kind === "state") ?? [];
  for (let i = states.length - 1; i >= 0; i--) {
    const item = states[i];
    if (item && item.kind === "state" && item.to !== "stuck" && item.to !== "dropped") return item.to;
    if (item && item.kind === "state" && (item.to === "stuck" || item.to === "dropped")) return item.from;
  }
  return "planning";
}

function Stepper({ node }: { readonly node: SessionNode }) {
  const failed = failedAt(node);
  const current = failed ? stepIndex(failed) : stepIndex(node.state);
  const done = node.state === "merged";
  return (
    <ol className="flex gap-1 overflow-x-auto border-b bg-card px-5 py-2" aria-label="Session progress">
      {STEPS.map((step, i) => {
        const isDone = done || i < current;
        const isCurrent = !done && i === current;
        const bad = isCurrent && failed !== null;
        return (
          <li
            key={step.key}
            aria-current={isCurrent ? "step" : undefined}
            className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground", isDone && "text-foreground", isCurrent && !bad && "bg-run/10 font-medium text-run", bad && (node.state === "stuck" ? "bg-bad/10 font-medium text-bad" : "bg-muted font-medium"))}
          >
            <span className={cn("grid size-3.5 place-items-center rounded-full border", isDone && "border-ok bg-ok text-background", isCurrent && !bad && "animate-spin border-run border-t-transparent", bad && node.state === "stuck" && "border-bad bg-bad")}>{isDone ? <Check className="size-2.5" strokeWidth={4} /> : null}</span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

function RetryDialog({ node, children }: { readonly node: SessionNode; readonly children: React.ReactNode }) {
  const { api, data } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const retry = async () => {
    try {
      await api.retry(node.id, guidance);
      toast.success(`Retrying ${short(node.id, 9)} with a fresh budget`);
      setOpen(false);
      setGuidance("");
      data.refresh();
    } catch (error) {
      toast.error("Retry failed", { description: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retry with guidance</DialogTitle>
          <DialogDescription>The session goes back to coding with a fresh budget. Your note and the last failure reach the coder on its next turn.</DialogDescription>
        </DialogHeader>
        <Textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={5} placeholder="What should the agent do differently?" aria-label="Guidance for the retry" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void retry()}>
            <RotateCcw />
            Retry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DropButton({ node }: { readonly node: SessionNode }) {
  const { api, data } = useWorkspace();
  const drop = async () => {
    try {
      await api.drop(node.id, "dropped by a person");
      toast.success(isActive(node.state) ? `Dropping ${short(node.id, 9)} after its current step` : `Dropped ${short(node.id, 9)}`);
      data.refresh();
    } catch (error) {
      toast.error("Drop failed", { description: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <OctagonX />
          Drop
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Drop this session?</AlertDialogTitle>
          <AlertDialogDescription>
            kargah stops working on {short(node.id, 9)} and it will never merge. Its fork and commits stay in Artifacts. A running step finishes first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void drop()}>
            Drop session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SessionView({ node, composerRef }: { readonly node: SessionNode; readonly composerRef: Ref<HTMLTextAreaElement> }) {
  const { api, data, openFeature, openSession, features } = useWorkspace();
  const end = useRef<HTMLDivElement>(null);
  const live = node.live;
  const record = node.record;
  const feature = features.find((f) => f.id === node.featureId);
  const title = feature?.title ?? record?.plan.feature.title ?? node.featureId;
  const active = isActive(node.state);
  const count = live?.timeline.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count, node.id]);

  const newAttempt = async () => {
    const prompt = record?.rootPrompt ?? title;
    try {
      const result = await api.prompt(`#${node.featureId} ${prompt}`);
      toast.success("Started a new session", { description: result.sessionIds.join(", ") });
      data.refresh();
      if (result.sessionId) openSession(result.sessionId);
    } catch (error) {
      toast.error("Could not start a session", { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const send = async (text: string) => {
    try {
      if (active) {
        await api.steer(node.id, text);
        toast.success("Note queued for the next turn");
      } else if (node.state === "stuck") {
        await api.retry(node.id, text);
        toast.success("Retrying with your guidance");
      } else {
        const result = await api.prompt(`#${node.featureId} ${text}`);
        toast.success("Sent as a change to this feature", { description: result.sessionIds.join(", ") });
        if (result.sessionId) openSession(result.sessionId);
      }
      data.refresh();
      return true;
    } catch (error) {
      toast.error("Not sent", { description: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  const preview = live?.preview ?? record?.preview ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-view="session" data-session={node.id} data-state={node.state}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-card px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={() => openFeature(node.featureId)}>
              {node.featureId}
            </button>
            <span>/</span>
            <span className="font-mono">{node.id}</span>
            {node.attempt && node.attempt.of > 1 ? <span>· attempt {node.attempt.index} of {node.attempt.of}</span> : null}
          </div>
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StateBadge state={node.state} dot />
          {preview ? (
            <Button variant="outline" size="sm" asChild>
              <a href={preview.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                Preview
              </a>
            </Button>
          ) : null}
          {node.state === "stuck" ? (
            <RetryDialog node={node}>
              <Button size="sm">
                <RotateCcw />
                Retry with guidance
              </Button>
            </RetryDialog>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void newAttempt()}>
            <GitFork />
            New attempt
          </Button>
          {node.state !== "merged" && node.state !== "dropped" ? <DropButton node={node} /> : null}
        </div>
      </header>
      <Stepper node={node} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          {record ? (
            <>
              <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap">{record.rootPrompt}</div>
              <div className="rounded-xl border bg-card">
                <div className="flex items-center gap-2 border-b px-3.5 py-2 text-sm font-medium">
                  <Route className="size-4 text-muted-foreground" />
                  Routed {record.decision.via === "classifier" ? "by Jev" : `by ${record.decision.via}`}
                </div>
                <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3.5 py-2.5 text-sm">
                  <dt className="text-muted-foreground">Intent</dt>
                  <dd>{record.decision.intent.replace("_", " ")}</dd>
                  <dt className="text-muted-foreground">Feature</dt>
                  <dd className="font-mono text-xs leading-5">{record.featureId}</dd>
                  <dt className="text-muted-foreground">Confidence</dt>
                  <dd>
                    {record.decision.confidence.toFixed(2)} · {record.decision.reason}
                  </dd>
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd>{record.plan.items.map((i) => `${i.role}: ${i.kind}`).join(", ")}</dd>
                  <dt className="text-muted-foreground">Fork</dt>
                  <dd className="truncate font-mono text-xs leading-5">{record.fork}</dd>
                </dl>
              </div>
            </>
          ) : null}
          <Timeline items={live?.timeline ?? []} live={active} sessionId={node.id} />
          {node.state === "stuck" ? (
            <Callout tone="bad" icon={AlertTriangle} title={<span className="text-bad">Stuck: {live?.stuck ?? record?.machine.reason ?? "no reason recorded"}</span>}>
              {record?.machine.feedback ? <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11.5px] whitespace-pre-wrap">{record.machine.feedback}</pre> : null}
              <div className="mt-1 flex flex-wrap gap-1.5">
                <RetryDialog node={node}>
                  <Button size="sm">
                    <RotateCcw />
                    Retry with guidance
                  </Button>
                </RetryDialog>
                <DropButton node={node} />
              </div>
            </Callout>
          ) : null}
          <div ref={end} />
        </div>
      </div>
      <Composer
        ref={composerRef}
        key={node.id}
        placeholder={active ? "Steer this session. Your note reaches the agent on its next turn." : node.state === "stuck" ? "Tell the agent what to do differently, then send to retry" : `Ask for a change to ${title}`}
        target={active ? `Steer ${short(node.id, 9)}` : node.state === "stuck" ? `Retry ${short(node.id, 9)}` : `#${node.featureId}`}
        note={active ? "Goes into the next turn" : stateTone(node.state) === "bad" ? "Fresh budget" : "Starts a new session"}
        onSend={send}
      />
    </div>
  );
}
