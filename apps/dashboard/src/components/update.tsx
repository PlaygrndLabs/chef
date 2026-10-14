import { useEffect, useRef, useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Step, type StepState } from "@/components/step";
import { useAppMode, orgLabel } from "@/lib/account";
import { updateApi, type UpdateRun, type UpdateState, type UpdateStepId } from "@/lib/api";

const STEPS: readonly (readonly [UpdateStepId, string])[] = [
  ["account", "Check your Cloudflare account"],
  ["image", "Add the new sandbox image"],
  ["token", "Keep the token for previews"],
  ["deploy", "Deploy the new chef"],
];

const STATE: Readonly<Record<UpdateRun["steps"][UpdateStepId], StepState>> = { waiting: "wait", running: "run", done: "done", failed: "failed", skipped: "done" };

export function UpdatePrompt(props: { readonly onStarted: () => void }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const later = () => {
    setOpen(false);
    void updateApi.later().catch(() => undefined);
  };
  const start = async () => {
    setBusy(true);
    try {
      await updateApi.start();
      setOpen(false);
      props.onStarted();
    } catch (e) {
      setBusy(false);
      toast.error("Could not start the update", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next || busy ? undefined : later())}>
      <DialogContent className="sm:max-w-md" data-dialog="update">
        <DialogHeader>
          <DialogTitle>A new version of chef is ready</DialogTitle>
          <DialogDescription>Updating takes a few minutes. While it runs, your projects and chef's settings are locked. Your account, organization and members stay open.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={later} disabled={busy} id="update-later">
            Later
          </Button>
          <Button type="button" onClick={() => void start()} disabled={busy} id="update-now">
            {busy ? "Starting…" : "Update now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdateLog(props: { readonly lines: readonly string[]; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.lines.length, props.open]);
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-update-log-toggle>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {props.open ? "Hide log" : "Show log"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre ref={box} className="mt-2 max-h-56 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap" role="log" aria-live="polite">
          {props.lines.length === 0 ? "Waiting for the update to start…" : props.lines.join("\n")}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function UpdateProgress() {
  const mode = useAppMode();
  const [state, setState] = useState<UpdateState | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = state?.install ?? null;
  const finished = run ? run.status === "done" || run.status === "failed" : state !== null && !state.running;
  useEffect(() => {
    if (finished) return;
    let live = true;
    const tick = () => void updateApi.state().then((next) => live && setState(next), () => undefined);
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [finished]);
  useEffect(() => {
    if (run?.status === "failed") setLogOpen(true);
  }, [run?.status]);
  useEffect(() => {
    if (finished && !run) location.assign("/");
  }, [finished, run]);
  const back = async () => {
    setBusy(true);
    await updateApi.finish().catch(() => undefined);
    location.assign("/");
  };
  const retry = async () => {
    setBusy(true);
    try {
      setState(await updateApi.start());
    } catch (e) {
      toast.error("Could not start the update", { description: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };
  const org = mode?.org ? orgLabel(mode.org) : "this organization";
  const title = run?.status === "done" ? "chef is up to date" : run?.status === "failed" ? "The update stopped" : "Updating chef";
  const note =
    run?.status === "done"
      ? "Your projects are open again."
      : run?.status === "failed"
        ? "Nothing was lost and your projects still run on the version you had. Fix what the message says and try again, or go back to your projects."
        : run || state === null
          ? "This takes a few minutes. Your projects and chef's settings are locked until it finishes. Your account, organization and members stay open in Settings."
          : `Someone who manages ${org} is updating chef. Your projects open again when it finishes.`;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-12 pb-16 sm:pt-20" data-update={run?.status ?? (finished ? "done" : "running")}>
      <div className="grid gap-1.5">
        {run?.status === "done" ? null : (
          <div className="kicker flex items-center gap-1.5 text-brand">
            <Lock className="size-3.5" />
            Projects locked
          </div>
        )}
        <h1 className="text-xl font-medium tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{note}</p>
      </div>
      {run ? (
        <>
          <ol className="grid gap-2.5">
            {STEPS.map(([id, label]) => (
              <Step key={id} state={STATE[run.steps[id]]}>
                {label}
                {run.steps[id] === "failed" && run.error ? <span className="block text-xs text-bad">{run.error}</span> : null}
              </Step>
            ))}
          </ol>
          {run.status === "failed" && run.error && !Object.values(run.steps).includes("failed") ? <p className="text-xs text-bad">{run.error}</p> : null}
          <UpdateLog lines={run.log} open={logOpen} onOpenChange={setLogOpen} />
        </>
      ) : null}
      {run?.status === "done" ? (
        <Button type="button" className="w-fit" onClick={() => void back()} disabled={busy} id="update-done">
          Back to your projects
        </Button>
      ) : run?.status === "failed" ? (
        <div className="flex gap-2">
          <Button type="button" onClick={() => void retry()} disabled={busy}>
            Try again
          </Button>
          <Button type="button" variant="outline" onClick={() => void back()} disabled={busy}>
            Back to your projects
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function LockedWhileUpdating() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border p-4 text-sm" data-locked="update">
      <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground">Locked while chef updates. This opens again when the update finishes.</p>
    </div>
  );
}
