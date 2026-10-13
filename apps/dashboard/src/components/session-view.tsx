import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Circle, Code2, FlaskConical, GitBranch, GitFork, GitMerge, ListChecks, Loader2, Maximize2, MessageSquareText, Minimize2, MoreHorizontal, OctagonX, RotateCcw, Rocket, ShieldCheck, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChangesTab, ChecksTab, DetailsTab, Empty, SessionPreview } from "@/components/session-sections";
import { KeyPrompt } from "@/components/environment";
import { KindBadges, StatusDot, StatusPill } from "@/components/status";
import { isActive } from "@/lib/events";
import { clock, PLAIN_STATE, stateTone } from "@/lib/format";
import { currentSession, heldBy, isChore, relationsOf, statusOf, waitsForKey, type FeatureNode, type SessionNode } from "@/lib/model";
import type { Panel as PanelTab } from "@/lib/selection";
import { activity, plainReason, progress, STAGES, updates, type Update, type UpdateIcon, type UpdateTone } from "@/lib/progress";
import { modelLabel, roleLabel, teamOf, useAgents, type MemberState } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const ICONS: Readonly<Record<UpdateIcon, typeof Check>> = { plan: ListChecks, test: FlaskConical, code: Code2, review: MessageSquareText, check: ShieldCheck, live: Rocket, alert: AlertTriangle, stop: OctagonX, sync: GitMerge, pick: Trophy };
const TONE: Readonly<Record<UpdateTone, string>> = { ok: "text-ok", run: "text-run", bad: "text-bad", idle: "text-muted-foreground" };

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
  const { openSettings, selection } = useWorkspace();
  const view = useAgents(selection.project);
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
            data-branch={m.branch ?? undefined}
            title={`${label} ${MEMBER_NOTE[m.state]}${model ? ` on ${model}` : ""}${m.branch ? `, on its own branch ${m.branch}` : ""}. Open its prompt and skills.`}
            onClick={() => openSettings("project", "agents", m.role)}
            className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs hover:bg-muted", MEMBER[m.state])}
          >
            {m.state === "done" ? <Check className="size-3 text-ok" strokeWidth={3} /> : m.state === "working" ? <span className="pulse-run size-1.5 rounded-full bg-run" /> : m.state === "stopped" ? <X className="size-3" strokeWidth={3} /> : <Circle className="size-2.5" />}
            {label}
            {m.branch ? <GitBranch className="size-3 text-muted-foreground" aria-label={`branch ${m.branch}`} /> : null}
            {m.state === "working" && model ? <span className="font-normal text-muted-foreground">· {model}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function UpdateRow({ update }: { readonly update: Update }) {
  const [open, setOpen] = useState(false);
  const view = useAgents(useWorkspace().selection.project);
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
  const { api, data, focusComposer } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const feedback = node.record?.machine.feedback;
  const retry = async () => {
    setBusy(true);
    try {
      await api.retry(node.id, "");
      toast.success("chef is trying again");
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
      <p className="text-sm text-muted-foreground">
        Press Try again, tell chef in the{" "}
        <button type="button" onClick={focusComposer} className="underline underline-offset-2 hover:text-foreground">
          chat
        </button>{" "}
        what to do differently, or stop this build. The live app is not affected.
      </p>
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

const SECTIONS: readonly { readonly value: PanelTab; readonly label: string }[] = [
  { value: "preview", label: "Preview" },
  { value: "messages", label: "Messages" },
  { value: "changes", label: "Changes" },
  { value: "checks", label: "Checks" },
  { value: "details", label: "Details" },
];

function Messages({ feature, node }: { readonly feature: FeatureNode; readonly node: SessionNode | null }) {
  const end = useRef<HTMLDivElement>(null);
  const timeline = node?.live?.timeline ?? [];
  const asked = node?.record ? { prompt: node.record.ask ?? node.record.rootPrompt, at: node.record.createdAt } : undefined;
  const list = node ? updates(timeline, node.state, asked) : [];
  const p = node ? progress(node.state, timeline) : null;
  const active = node ? isActive(node.state) : false;
  const held = node ? heldBy(node) : null;
  const criteria = feature.spec?.acceptance ?? [];
  const isLive = node ? node.state === "merged" : feature.status === "merged";
  useEffect(() => {
    if (active) end.current?.scrollIntoView({ block: "end" });
  }, [list.length, node?.id, active]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-messages>
      {node && p ? (
        <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" data-summary>
          <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 py-3 sm:px-6">
            <TryTabs node={node} />
            <Steps node={node} />
            <Team node={node} />
            <p className={cn("text-sm", p.failed && "font-medium text-bad")}>{node.state === "stuck" ? plainReason(node.live?.stuck ?? node.record?.machine.reason ?? "") || p.now : waitsForKey(node) ? `Waiting for ${node.needs.join(", ")}` : held ? `Passed review. Waiting for hotfix ${held} to go live first.` : active ? activity(node.state, timeline, null) : p.now}</p>
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
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
  );
}

function Scroll({ children }: { readonly children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>;
}

export function SessionView({ feature }: { readonly feature: FeatureNode }) {
  const { api, data, selection, select, openSession, panelExpanded, expandPanel } = useWorkspace();
  const node = currentSession(feature, selection.session);
  const [stopping, setStopping] = useState(false);
  const section = selection.panel ?? "preview";
  const active = node ? isActive(node.state) : false;
  const chore = node ? isChore(node) : feature.id.startsWith("chore-") && !feature.onMain;

  const startOver = async () => {
    const asked = (node?.record?.ask ?? node?.record?.rootPrompt ?? feature.title).replace(/^\/(chore|hotfix)\b\s*/i, "");
    try {
      const result = await api.prompt(chore ? `/chore ${asked}` : `#${feature.id} ${asked}`);
      toast.success("Started over");
      data.refresh();
      if (result.sessionId) openSession(result.sessionId);
    } catch (error) {
      toast.error("Could not start over", { description: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <Tabs value={section} onValueChange={(v) => select({ panel: v as PanelTab })} className="flex h-full min-h-0 flex-col gap-0 bg-background" data-view="feature" data-feature={feature.id} data-session={node?.id} data-state={node?.state}>
      <header className="flex h-12 shrink-0 items-center gap-2.5 px-4">
        <h1 className="min-w-0 truncate text-base font-semibold">{feature.title}</h1>
        <StatusPill status={node ? statusOf(node.state) : feature.status} />
        {node ? <KindBadges node={node} /> : null}
        {node ? (
          <span className="hidden truncate font-mono text-xs text-muted-foreground xl:inline" data-build-label>
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
        <Button variant="ghost" size="icon-sm" onClick={() => expandPanel(!panelExpanded)} aria-label={panelExpanded ? "Make smaller" : "Open large"} title={panelExpanded ? "Make smaller" : "Open large"}>
          {panelExpanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {node?.state === "dropped" ? null : <DropdownMenuItem onClick={() => void startOver()}>Start over</DropdownMenuItem>}
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
      <div className="flex shrink-0 items-center border-b px-3 pb-2">
        <TabsList className="h-8 max-w-full justify-start">
          {SECTIONS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="min-w-0 px-2.5 text-[13px]">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {node?.state === "stuck" || (node && waitsForKey(node)) ? (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-b p-3">
          {node.state === "stuck" ? <NeedsYou node={node} /> : <KeyPrompt names={node.needs} api={api} onSaved={data.refresh} />}
        </div>
      ) : null}
      <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col p-4">
        <SessionPreview feature={feature} node={node} />
      </TabsContent>
      <TabsContent value="messages" className="flex min-h-0 flex-1 flex-col">
        <Messages feature={feature} node={node} />
      </TabsContent>
      <TabsContent value="changes" className="flex min-h-0 flex-1 flex-col">
        <Scroll>{node ? <ChangesTab node={node} /> : <Empty>Nothing built yet.</Empty>}</Scroll>
      </TabsContent>
      <TabsContent value="checks" className="flex min-h-0 flex-1 flex-col">
        <Scroll>{node ? <ChecksTab node={node} /> : <Empty>Nothing built yet.</Empty>}</Scroll>
      </TabsContent>
      <TabsContent value="details" className="flex min-h-0 flex-1 flex-col">
        <Scroll>{node ? <DetailsTab node={node} /> : <Empty>Nothing built yet.</Empty>}</Scroll>
      </TabsContent>
      {node ? <StopDialog node={node} open={stopping} onOpenChange={setStopping} /> : null}
    </Tabs>
  );
}
