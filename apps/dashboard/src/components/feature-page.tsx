import { useEffect, useRef, useState, type Ref } from "react";
import { AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Circle, Code2, FileCode2, FlaskConical, GitCommitHorizontal, GitFork, GitMerge, Globe, ListChecks, Loader2, MessageSquareText, MoreHorizontal, OctagonX, PanelRight, RotateCcw, Rocket, ShieldCheck, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Composer } from "@/components/composer";
import { StatusDot, StatusPill } from "@/components/status";
import { statusOf } from "@/components/home";
import { isActive } from "@/lib/events";
import { clock, PLAIN_STATE, previewHost, stateTone } from "@/lib/format";
import { relationsOf, type FeatureNode, type SessionNode } from "@/lib/model";
import type { Panel as PanelTab } from "@/lib/selection";
import { isTestFile } from "@/lib/routes";
import { useFetch } from "@/lib/use-fetch";
import { activity, plainReason, progress, STAGES, updates, type Update, type UpdateIcon, type UpdateTone } from "@/lib/progress";
import { modelLabel, roleLabel, teamOf, useAgents, type MemberState } from "@/lib/agents";
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

const MEMBER: Readonly<Record<MemberState, string>> = {
  done: "text-foreground",
  working: "border-run/40 bg-run/10 font-medium text-run",
  next: "border-dashed text-muted-foreground",
  stopped: "border-bad/40 bg-bad/5 text-bad",
};

const MEMBER_NOTE: Readonly<Record<MemberState, string>> = { done: "did its part", working: "is working now", next: "comes later", stopped: "was working when chef stopped" };

function Team({ node }: { readonly node: SessionNode }) {
  const view = useAgents();
  const { select } = useWorkspace();
  const team = teamOf(node);
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Who works on this build" data-team>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Bot className="size-3.5" />
        Team
      </span>
      {team.map((m) => {
        const label = roleLabel(m.role, view);
        const model = modelLabel(m.role, m.model, view);
        return (
          <button
            key={m.role}
            type="button"
            data-member={m.role}
            data-member-state={m.state}
            title={`${label} ${MEMBER_NOTE[m.state]}${model ? ` on ${model}` : ""}. Open its prompt and skills.`}
            onClick={() => select({ view: "agents", tab: "roles", item: m.role, feature: null, session: null, panel: null })}
            className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs hover:bg-muted", MEMBER[m.state])}
          >
            {m.state === "done" ? <Check className="size-3 text-ok" strokeWidth={3} /> : m.state === "working" ? <span className="pulse-run size-1.5 rounded-full bg-run" /> : m.state === "stopped" ? <X className="size-3" strokeWidth={3} /> : <Circle className="size-2.5" />}
            {label}
            {m.state === "working" && model ? <span className="font-normal text-muted-foreground">· {model}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function UpdateRow({ update }: { readonly update: Update }) {
  const [open, setOpen] = useState(false);
  const view = useAgents();
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
          {update.role ? <span data-update-role={update.role}>{roleLabel(update.role, view)}</span> : null}
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
      toast.success("chef is trying again");
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
      <div className="font-semibold text-bad">chef needs your help</div>
      <p className="text-sm text-muted-foreground">Tell it what to do differently and press Try again, or stop this build. The live app is not affected.</p>
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
      <Textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={3} placeholder="Tell chef what to do differently" aria-label="Tell chef what to do differently" className="bg-background" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void retry()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Try again
        </Button>
        <Button variant="ghost" onClick={() => setStopping(true)}>
          Stop this build
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
          <AlertDialogDescription>chef stops working on it and nothing goes live. The work so far is kept, and you can start over later.</AlertDialogDescription>
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

function BuildChip({ node, current }: { readonly node: SessionNode; readonly current: boolean }) {
  const { openSession } = useWorkspace();
  const tries = node.attempt && node.attempt.of > 1 ? ` · try ${node.attempt.index}` : "";
  return (
    <button
      type="button"
      onClick={() => openSession(node.id)}
      aria-current={current ? "true" : undefined}
      data-build={node.id}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs hover:bg-muted", current && "border-foreground/40 bg-muted font-medium")}
    >
      <StatusDot tone={stateTone(node.state)} />
      <span className="font-mono">{node.id}</span>
      <span className="text-muted-foreground">
        {PLAIN_STATE[node.state]}
        {tries}
      </span>
    </button>
  );
}

function Related({ node }: { readonly node: SessionNode }) {
  const { sessions } = useWorkspace();
  const r = relationsOf(node, sessions);
  const chain = r.chain.filter((s) => s.id === node.id || !node.attempt || s.attempt?.group !== node.attempt.group);
  if (chain.length < 2) return null;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border p-4" data-related={node.id}>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xs font-medium text-muted-foreground">Builds of this feature, oldest first</h2>
        <ol className="flex flex-wrap items-center gap-1">
          {chain.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3.5 text-muted-foreground" /> : null}
              <BuildChip node={s} current={s.id === node.id} />
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{r.parent ? `This build continues from ${r.parent.id}. ` : ""}Each new build starts from the live app, so earlier work that went live is kept.</p>
      </div>
    </section>
  );
}

function picksOf(node: SessionNode, sessions: readonly SessionNode[]) {
  const r = relationsOf(node, sessions);
  const pick = r.attempts.flatMap((s) => s.live?.timeline ?? []).find((t) => t.kind === "picked");
  const picked = pick?.kind === "picked" ? pick : null;
  const winner = picked ? r.attempts.find((s) => s.id === picked.winner) : undefined;
  return { attempts: r.attempts, picked, winner };
}

function TryTabs({ node }: { readonly node: SessionNode }) {
  const { sessions, openSession } = useWorkspace();
  const { attempts, picked, winner } = picksOf(node, sessions);
  if (!node.attempt || attempts.length < 2) return null;
  const running = attempts.some((s) => isActive(s.state));
  const score = (id: string) => picked?.candidates.find((c) => c.sessionId === id);
  const note = picked
    ? `chef built this ${attempts.length} ways at once and picked try ${winner?.attempt?.index ?? picked.winner}.`
    : running
      ? `chef builds this ${attempts.length} ways at once, then keeps the one that passes the most checks.`
      : `chef built this ${attempts.length} ways at once.`;
  return (
    <div className="flex flex-col gap-1" data-tries>
      <div role="tablist" aria-label="Parallel tries" className="flex gap-1 overflow-x-auto">
        {attempts.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === node.id}
            onClick={() => openSession(s.id)}
            data-try={s.id}
            className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs hover:bg-muted", s.id === node.id ? "border-foreground/40 bg-muted font-medium" : "text-muted-foreground")}
          >
            <GitFork className="size-3.5" />
            Try {s.attempt?.index}
            <StatusDot tone={stateTone(s.state)} />
            <span className="font-normal text-muted-foreground">{PLAIN_STATE[s.state]}</span>
            {score(s.id) ? <span className="font-normal text-muted-foreground tabular-nums">· {score(s.id)?.passed}/{score(s.id)?.total} tests</span> : null}
            {picked?.winner === s.id ? <Trophy className="size-3.5 text-ok" aria-label="Picked" /> : null}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function PickReasons({ node }: { readonly node: SessionNode }) {
  const { sessions } = useWorkspace();
  const { attempts, picked, winner } = picksOf(node, sessions);
  if (!picked || attempts.length < 2) return null;
  return (
    <section className="flex flex-col gap-1.5 rounded-2xl border p-4 text-sm" data-pick-reasons>
      <h2 className="inline-flex items-center gap-1.5 font-medium">
        <Trophy className="size-4 text-ok" />
        Why try {winner?.attempt?.index ?? picked.winner} was picked
      </h2>
      <p className="text-xs text-muted-foreground">Each try's code ran against the tests of every try. The reviewer then compared the scores and the code.</p>
      <ul className="list-disc pl-5 text-muted-foreground">
        {picked.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </section>
  );
}

function Pill({ icon: Icon, label, value, tone, panel, id }: { readonly icon: typeof Check; readonly label: string; readonly value: string; readonly tone: "ok" | "bad" | "idle" | "plain"; readonly panel: PanelTab; readonly id: string }) {
  const { select } = useWorkspace();
  return (
    <button type="button" onClick={() => select({ panel })} data-artifact={id} title={`${label}: ${value}`} className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-lg border bg-card px-2 text-xs hover:bg-muted/60">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("truncate font-medium", tone === "ok" && "text-ok", tone === "bad" && "text-bad", tone === "idle" && "font-normal text-muted-foreground")}>{value}</span>
    </button>
  );
}

function Artifacts({ node, preview }: { readonly node: SessionNode; readonly preview: { readonly url: string } | null }) {
  const { api } = useWorkspace();
  const commits = node.live?.commits.length ?? node.record?.commits.length ?? 0;
  const head = node.live?.commits.at(-1)?.id ?? node.record?.head ?? "";
  const changes = useFetch(commits ? () => api.changes(node.id) : null, `${node.id}:${head}`);
  const files = changes.data?.files ?? [];
  const tests = files.filter((f) => isTestFile(f.path)).length;
  const verdict = node.live?.verdict ?? node.record?.verdict ?? null;
  const gate = node.live?.gate ?? null;
  const failed = gate ? gate.checks.filter((c) => !c.ok).length : 0;
  const used = node.record?.machine.usage.attempts ?? 0;
  const tries = node.state === "stuck" && /^attempt budget/.test(node.live?.stuck ?? node.record?.machine.reason ?? "") ? used - 1 : used;
  return (
    <div className="flex flex-wrap gap-1.5 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4" aria-label="What this build made" data-artifacts>
      <Pill id="preview" icon={Globe} label="Preview" panel="preview" value={preview ? previewHost(preview.url) : "not ready"} tone={preview ? "plain" : "idle"} />
      <Pill id="files" icon={FileCode2} label="Files" panel="changes" value={files.length ? `${files.length - tests} code, ${tests} test` : changes.loading ? "loading" : "none yet"} tone={files.length ? "plain" : "idle"} />
      <Pill id="commits" icon={GitCommitHorizontal} label="Commits" panel="details" value={commits ? String(commits) : "none yet"} tone={commits ? "plain" : "idle"} />
      <Pill id="review" icon={MessageSquareText} label="Review" panel="checks" value={verdict ? (verdict.approve ? "approved" : "asked for changes") : "not yet"} tone={verdict ? (verdict.approve ? "ok" : "bad") : "idle"} />
      <Pill id="checks" icon={ShieldCheck} label="Checks" panel="checks" value={gate ? (gate.ok ? `${gate.checks.length} of ${gate.checks.length} passed` : `${failed} of ${gate.checks.length} failed`) : "not run yet"} tone={gate ? (gate.ok ? "ok" : "bad") : "idle"} />
      {tries > 1 ? <Pill id="tries" icon={RotateCcw} label="Tries" panel="details" value={String(tries)} tone="plain" /> : null}
      {node.live?.recalled.length ? <Pill id="lessons" icon={ListChecks} label="Lessons used" panel="details" value={String(node.live.recalled.length)} tone="plain" /> : null}
    </div>
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
  const preview = node?.live?.preview ?? node?.record?.preview ?? feature.preview;
  const panel = selection.panel;
  const criteria = feature.spec?.acceptance ?? [];
  const isLive = node ? node.state === "merged" : feature.status === "merged";

  useEffect(() => {
    if (active) end.current?.scrollIntoView({ block: "end" });
  }, [list.length, node?.id, active]);

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
        toast.success("chef reads your note on its next step");
      } else if (node?.state === "stuck") {
        await api.retry(node.id, text);
        toast.success("chef is trying again with your note");
      } else {
        const result = await api.prompt(`#${feature.id} ${text}`);
        toast.success("chef started on your change");
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
        <StatusPill status={node ? statusOf(node.state) : feature.status} />
        {node ? (
          <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline" data-build-label>
            build {node.id}
            {node.attempt && node.attempt.of > 1 ? ` · try ${node.attempt.index} of ${node.attempt.of}` : ""}
          </span>
        ) : null}
        <span className="flex-1" />
        {node && active ? (
          <Button variant="outline" size="sm" onClick={() => setStopping(true)}>
            <OctagonX />
            Stop
          </Button>
        ) : null}
        {node?.state === "dropped" ? (
          <Button variant="outline" size="sm" onClick={() => void startOver()}>
            <RotateCcw />
            Start over
          </Button>
        ) : null}
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
                      <span className="ml-auto text-xs text-muted-foreground">{PLAIN_STATE[s.state]}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {node && p ? (
          <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" data-summary>
            <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 py-3 sm:px-6">
              <TryTabs node={node} />
              <Steps node={node} />
              <Team node={node} />
              <p className={cn("text-sm", p.failed && "font-medium text-bad")}>{node.state === "stuck" ? plainReason(node.live?.stuck ?? node.record?.machine.reason ?? "") || p.now : active ? activity(node.state, timeline, null) : p.now}</p>
              <Artifacts node={node} preview={preview} />
            </div>
          </div>
        ) : null}
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
          {node ? null : (
            <div className="flex flex-col gap-2 rounded-2xl border p-4">
              <p>chef has not built this yet.</p>
              {feature.spec?.body ? <p className="text-muted-foreground">{feature.spec.body}</p> : null}
              <p className="text-sm text-muted-foreground">Describe what you want below and it starts.</p>
            </div>
          )}
          {node?.state === "stuck" ? <NeedsYou node={node} /> : null}
          {node ? <PickReasons node={node} /> : null}
          {node ? <Related node={node} /> : null}
          {criteria.length ? (
            <section className="flex flex-col gap-2.5" data-criteria>
              <h2 className="text-xs font-medium text-muted-foreground">{isLive ? "What it does" : "What it must do to go live"}</h2>
              <ul className="flex flex-col gap-2">
                {criteria.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    {isLive ? <Check className="mt-1 size-4 shrink-0 text-ok" strokeWidth={2.6} /> : <span className="mt-2 size-2 shrink-0 rounded-full border border-muted-foreground" />}
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {list.length ? <h2 className="-mb-2 text-xs font-medium text-muted-foreground">What happened</h2> : null}
          {list.map((u) => (
            <UpdateRow key={u.key} update={u} />
          ))}
          <div ref={end} />
        </div>
      </div>
      <Composer
        ref={composerRef}
        key={node?.id ?? feature.id}
        placeholder={active ? "Add a note. chef reads it on its next step" : node?.state === "stuck" ? "Or reply here with a hint" : `Ask for a change to ${feature.title}`}
        hint={active ? "Your note does not restart the work" : node?.state === "stuck" ? "Sending tries again with your hint" : "Starts a new build of this feature"}
        onSend={send}
      />
      {node ? <StopDialog node={node} open={stopping} onOpenChange={setStopping} /> : null}
    </div>
  );
}
