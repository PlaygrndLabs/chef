import { useState } from "react";
import { Bot, ChevronDown, CornerDownRight, GitFork } from "lucide-react";
import { FEATURE_LABEL, FEATURE_TONE, StatusDot } from "@/components/status";
import { ago, PLAIN_STATE, stateTone } from "@/lib/format";
import { groupSessions, sortFeatures, type FeatureNode, type SessionGroup, type SessionNode } from "@/lib/model";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/live";
import { useWorkspace } from "@/lib/workspace";
import { roleLabel, useAgents, workingRole } from "@/lib/agents";

type Mode = "status" | "feature";

const MODE_KEY = "chef:work-list";

const GROUP_TITLE: Readonly<Record<SessionGroup, string>> = { "needs-you": "Needs you", working: "Working", live: "Live", stopped: "Stopped" };
const GROUP_TONE: Readonly<Record<SessionGroup, string>> = { "needs-you": "text-bad", working: "text-run", live: "text-ok", stopped: "text-muted-foreground" };

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "feature" ? "feature" : "status";
  } catch {
    return "status";
  }
}

function SessionRow({ node, nested = false, showTitle = true }: { readonly node: SessionNode; readonly nested?: boolean; readonly showTitle?: boolean }) {
  const { features, session, openSession } = useWorkspace();
  const now = useNow(15000);
  const title = features.find((f) => f.id === node.featureId)?.title ?? node.featureId;
  const tone = stateTone(node.state);
  const tries = node.attempt && node.attempt.of > 1 ? `try ${node.attempt.index} of ${node.attempt.of}` : null;
  const selected = session?.id === node.id;
  const agents = useAgents();
  const role = workingRole(node);
  return (
    <button
      type="button"
      onClick={() => openSession(node.id)}
      data-session={node.id}
      data-state={node.state}
      aria-current={selected ? "page" : undefined}
      className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent", selected && "bg-sidebar-accent", nested && "pl-3")}
    >
      {nested ? <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" /> : <StatusDot tone={tone} className="mt-1.5" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {nested ? <StatusDot tone={tone} /> : null}
          <span className={cn("min-w-0 flex-1 truncate text-sm", !showTitle && "text-muted-foreground")}>{showTitle ? title : tries ? `Try ${node.attempt?.index ?? ""}` : `Build ${node.id}`}</span>
          <span className={cn("shrink-0 text-xs text-muted-foreground", tone === "bad" && "font-medium text-bad", tone === "run" && "text-run")}>{PLAIN_STATE[node.state]}</span>
        </span>
        <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          {role ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-run" data-working-role={role}>
              <Bot className="size-3" />
              {roleLabel(role, agents)}
            </span>
          ) : null}
          {showTitle || tries ? <span className="font-mono">{node.id}</span> : null}
          {tries && showTitle ? (
            <span className="inline-flex items-center gap-0.5">
              <GitFork className="size-3" />
              {tries}
            </span>
          ) : null}
          {node.parent ? <span>after {node.parent}</span> : null}
          <span className="ml-auto shrink-0">{ago(node.updatedAt, now)}</span>
        </span>
      </span>
    </button>
  );
}

function TriesHeader({ node, count }: { readonly node: SessionNode; readonly count: number }) {
  const { features, openSession } = useWorkspace();
  const title = features.find((f) => f.id === node.featureId)?.title ?? node.featureId;
  return (
    <button type="button" onClick={() => openSession(node.id)} className="flex items-center gap-2 rounded-lg px-2 pt-1 text-left hover:bg-sidebar-accent">
      <GitFork className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{count} tries at once</span>
    </button>
  );
}

function bundle(list: readonly SessionNode[]): SessionNode[][] {
  const out: SessionNode[][] = [];
  const seen = new Map<string, SessionNode[]>();
  for (const s of list) {
    const key = s.attempt && s.attempt.of > 1 ? s.attempt.group : null;
    const existing = key ? seen.get(key) : undefined;
    if (existing) existing.push(s);
    else {
      const group = [s];
      if (key) seen.set(key, group);
      out.push(group);
    }
  }
  for (const group of out) group.sort((a, b) => (a.attempt?.index ?? 0) - (b.attempt?.index ?? 0));
  return out;
}

function Group({ group, list, open: initial, extra = [] }: { readonly group: SessionGroup; readonly list: readonly SessionNode[]; readonly open: boolean; readonly extra?: readonly FeatureNode[] }) {
  const [open, setOpen] = useState(initial);
  if (!list.length && !extra.length) return null;
  return (
    <section data-group={group} className="flex flex-col gap-px">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={open}>
        <span className={GROUP_TONE[group]}>{GROUP_TITLE[group]}</span>
        <span className="tabular-nums">{list.length + extra.length}</span>
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", !open && "-rotate-90")} />
      </button>
      {open
        ? bundle(list).map((members) =>
            members.length > 1 ? (
              <div key={members[0]?.id} className="flex flex-col gap-px rounded-lg border border-dashed border-sidebar-border py-0.5" data-attempts={members[0]?.attempt?.group}>
                <TriesHeader node={members[0] as SessionNode} count={members.length} />
                {members.map((m) => (
                  <SessionRow key={m.id} node={m} nested showTitle={false} />
                ))}
              </div>
            ) : (
              <SessionRow key={members[0]?.id} node={members[0] as SessionNode} />
            ),
          )
        : null}
      {open ? extra.map((f) => <FeatureRow key={f.id} feature={f} />) : null}
    </section>
  );
}

function FeatureRow({ feature }: { readonly feature: FeatureNode }) {
  const { selection, openFeature } = useWorkspace();
  const tone = FEATURE_TONE[feature.status];
  const current = selection.view === "feature" && selection.feature === feature.id;
  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        onClick={() => openFeature(feature.id)}
        data-feature={feature.id}
        data-status={feature.status}
        aria-current={current && !selection.session ? "page" : undefined}
        className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent", current && !selection.session && "bg-sidebar-accent")}
      >
        <StatusDot tone={tone} />
        <span className="min-w-0 flex-1 truncate">{feature.title}</span>
        <span className={cn("shrink-0 text-xs text-muted-foreground", tone === "bad" && "font-medium text-bad")}>{FEATURE_LABEL[feature.status]}</span>
      </button>
      {feature.sessions.length > 1 ? [...feature.sessions].reverse().map((s) => <SessionRow key={s.id} node={s} nested showTitle={false} />) : null}
    </div>
  );
}

export function WorkList() {
  const { features, sessions } = useWorkspace();
  const [mode, setMode] = useState<Mode>(readMode);
  const choose = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      return;
    }
  };
  const groups = groupSessions(sessions);
  const latestLive = new Set<string>();
  groups.live = groups.live.filter((s) => (latestLive.has(s.featureId) ? false : (latestLive.add(s.featureId), true)));
  const planned = features.filter((f) => f.sessions.length === 0 && f.status !== "merged");
  const template = features.filter((f) => f.sessions.length === 0 && f.status === "merged");
  const list = sortFeatures(features.filter((f) => f.status !== "dropped" || f.onMain));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-1 px-1" role="tablist" aria-label="Group the work">
        {(
          [
            ["status", "By status"],
            ["feature", "By feature"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => choose(value)} className={cn("rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground", mode === value && "bg-sidebar-accent text-foreground")}>
            {label}
          </button>
        ))}
      </div>
      <nav id="features" aria-label={mode === "status" ? "Builds by status" : "Features"} data-mode={mode} className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
        {mode === "status" ? (
          <>
            <Group group="needs-you" list={groups["needs-you"]} open />
            <Group group="working" list={groups.working} open />
            <Group group="live" list={groups.live} open extra={template} />
            {planned.length ? (
              <section data-group="planned" className="flex flex-col gap-px">
                <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  Not built yet <span className="tabular-nums">{planned.length}</span>
                </div>
                {planned.map((f) => (
                  <FeatureRow key={f.id} feature={f} />
                ))}
              </section>
            ) : null}
            <Group group="stopped" list={groups.stopped} open={false} />
          </>
        ) : (
          list.map((f) => <FeatureRow key={f.id} feature={f} />)
        )}
        {features.length === 0 ? <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">Your features and their builds show up here as chef works on them.</p> : null}
      </nav>
    </div>
  );
}
