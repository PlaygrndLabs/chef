import { useState } from "react";
import type { SessionState } from "@kargah/core";
import { AlertTriangle, BookOpen, Check, ChevronDown, CircleDot, Eye, FileText, GitCommitHorizontal, GitMerge, GitPullRequestArrow, Loader2, MessageSquareText, Pencil, ShieldCheck, Terminal, Trophy, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToneBadge } from "@/components/status";
import type { TimelineItem } from "@/lib/events";
import { clock, previewHost, short, STATE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

type AgentItem = Extract<TimelineItem, { kind: "text" | "tool" | "error" }>;

type Block =
  | { readonly kind: "agent"; readonly phase: SessionState; readonly items: AgentItem[]; commit: Extract<TimelineItem, { kind: "commit" }> | null; readonly at: number }
  | { readonly kind: "item"; readonly item: TimelineItem };

const PHASE_ROLE: Partial<Record<SessionState, string>> = { planning: "Planner", testing: "Test agent", coding: "Coder", reviewing: "Reviewer", gating: "Gate" };

function blocks(items: readonly TimelineItem[]): Block[] {
  const out: Block[] = [];
  let open = null as Extract<Block, { kind: "agent" }> | null;
  for (const item of items) {
    if (item.kind === "text" || item.kind === "tool" || item.kind === "error") {
      const phase: SessionState = item.kind === "error" ? (open?.phase ?? "coding") : item.phase;
      if (!open || open.phase !== phase || open.commit) {
        open = { kind: "agent", phase, items: [], commit: null, at: item.at };
        out.push(open);
      }
      open.items.push(item);
      continue;
    }
    if (item.kind === "commit") {
      if (open && !open.commit) open.commit = item;
      else out.push({ kind: "item", item });
      open = null;
      continue;
    }
    if (item.kind === "state") open = null;
    out.push({ kind: "item", item });
  }
  return out;
}

const TOOL_ICON: Record<string, typeof Pencil> = { Edit: Pencil, Write: Pencil, MultiEdit: Pencil, Read: FileText, Bash: Terminal, edit: Pencil, write: Pencil, read: FileText, bash: Terminal };

function AgentBlock({ block, live }: { readonly block: Extract<Block, { kind: "agent" }>; readonly live: boolean }) {
  const role = block.commit ? block.commit.role : (PHASE_ROLE[block.phase] ?? STATE_LABEL[block.phase]);
  const tools = block.items.filter((i) => i.kind === "tool");
  return (
    <div className="flex gap-3" data-turn={block.phase}>
      <span className="grid size-7 shrink-0 place-items-center rounded-lg border bg-muted text-xs font-semibold uppercase">{role.slice(0, 1)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold capitalize">{role}</span>
          <span className="text-xs text-muted-foreground">{clock(block.at)}</span>
        </div>
        {block.items.map((item, i) => {
          if (item.kind === "text") return item.text.trim() ? <p key={i} className="text-sm whitespace-pre-wrap">{item.text.trim()}</p> : null;
          if (item.kind === "error")
            return (
              <p key={i} className="rounded-md border border-bad/30 bg-bad/5 px-2.5 py-1.5 text-xs text-bad">
                {item.message}
              </p>
            );
          const Icon = TOOL_ICON[item.tool] ?? CircleDot;
          const last = live && !block.commit && item === tools[tools.length - 1] && i === block.items.length - 1;
          return (
            <div key={i} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1 text-xs">
              {last ? <Loader2 className="size-3.5 animate-spin text-run" /> : <Icon className="size-3.5 text-muted-foreground" />}
              <span className="w-12 shrink-0 font-medium">{item.tool}</span>
              <span className="truncate font-mono text-muted-foreground">{item.detail}</span>
            </div>
          );
        })}
        {live && !block.commit ? (
          <span className="flex items-center gap-1.5 text-xs text-run">
            <Loader2 className="size-3 animate-spin" />
            Working
          </span>
        ) : null}
        {block.commit ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitCommitHorizontal className="size-3.5" />
            <span className="font-mono">{short(block.commit.commitId)}</span>
            <span className="truncate">{block.commit.message}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Callout({ tone, icon: Icon, title, children }: { readonly tone: "ok" | "bad" | "warn" | "run" | "idle"; readonly icon: typeof Check; readonly title: React.ReactNode; readonly children?: React.ReactNode }) {
  const tones = { ok: "border-ok/30 bg-ok/5", bad: "border-bad/30 bg-bad/5", warn: "border-warn/30 bg-warn/5", run: "border-run/30 bg-run/5", idle: "bg-card" };
  const icons = { ok: "text-ok", bad: "text-bad", warn: "text-warn", run: "text-run", idle: "text-muted-foreground" };
  return (
    <div className={cn("flex gap-3 rounded-xl border px-3.5 py-2.5", tones[tone])}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", icons[tone])} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <div className="font-medium">{title}</div>
        {children}
      </div>
    </div>
  );
}

function GateCard({ item }: { readonly item: Extract<TimelineItem, { kind: "gate" }> }) {
  const [open, setOpen] = useState(!item.ok);
  const failed = item.checks.filter((c) => !c.ok);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card" data-gate={item.ok ? "passed" : "failed"}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm">
        <ShieldCheck className={cn("size-4", item.ok ? "text-ok" : "text-bad")} />
        <span className="font-medium">{item.ok ? "Gate passed" : "Gate failed"}</span>
        <span className="text-xs text-muted-foreground">
          {item.checks.length - failed.length} of {item.checks.length} checks
        </span>
        <span className="flex-1" />
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3.5 py-2.5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-1.5">
          {item.checks.map((c) => (
            <span key={c.name} className="flex items-center gap-1.5 text-xs">
              {c.ok ? <Check className="size-3.5 text-ok" /> : <X className="size-3.5 text-bad" />}
              {c.name}
            </span>
          ))}
        </div>
        {failed.map((c) =>
          c.log ? (
            <pre key={c.name} className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11.5px] whitespace-pre-wrap">
              {c.name}
              {"\n"}
              {c.log}
            </pre>
          ) : null,
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ItemView({ item, sessionId }: { readonly item: TimelineItem; readonly sessionId: string }) {
  switch (item.kind) {
    case "created":
      return null;
    case "state":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-transition={item.to}>
          <span className="h-px flex-1 bg-border" />
          <span>
            {STATE_LABEL[item.from]} → <span className="text-foreground">{STATE_LABEL[item.to]}</span>
            {item.reason && item.reason !== item.to ? ` · ${item.reason.replaceAll("_", " ")}` : ""}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    case "commit":
      return (
        <span className="flex items-center gap-1.5 pl-10 text-xs text-muted-foreground">
          <GitCommitHorizontal className="size-3.5" />
          <span className="font-mono">{short(item.commitId)}</span> {item.role} · {item.message}
        </span>
      );
    case "preview":
      return (
        <span className="flex items-center gap-1.5 pl-10 text-xs text-muted-foreground">
          <Eye className="size-3.5" />
          Preview rebuilt from <span className="font-mono">{short(item.commitId)}</span>
          <a href={item.url} target="_blank" rel="noreferrer" className="truncate text-run hover:underline">
            {previewHost(item.url)}
          </a>
        </span>
      );
    case "review":
      return (
        <Callout tone={item.approve ? "ok" : "warn"} icon={MessageSquareText} title={<span data-review={item.approve ? "approved" : "rejected"}>{item.approve ? "Review approved" : "Review asked for changes"}</span>}>
          <span className="text-xs text-muted-foreground">{item.model}</span>
          <ul className="list-disc pl-4 text-sm">
            {item.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Callout>
      );
    case "gate":
      return <GateCard item={item} />;
    case "rejected":
      return (
        <Callout tone="warn" icon={AlertTriangle} title={`Turn discarded: ${item.rule.replaceAll("-", " ")}`}>
          <span className="text-sm">
            The {item.role} turn touched <span className="font-mono text-xs">{item.paths.join(", ")}</span>. kargah dropped it and sent the rule back as feedback.
          </span>
        </Callout>
      );
    case "sync":
      return item.conflict ? (
        <Callout tone="warn" icon={GitPullRequestArrow} title="Main moved and the merge conflicted">
          <span className="font-mono text-xs">{item.paths.join(", ")}</span>
        </Callout>
      ) : (
        <span className="flex items-center gap-1.5 pl-10 text-xs text-muted-foreground">
          <GitPullRequestArrow className="size-3.5" />
          Merged main <span className="font-mono">{short(item.mainCommit)}</span> into the fork
        </span>
      );
    case "recalled":
      return (
        <span className="flex items-center gap-1.5 pl-10 text-xs text-muted-foreground">
          <BookOpen className="size-3.5" />
          Recalled {item.paths.length} memory {item.paths.length === 1 ? "note" : "notes"}
        </span>
      );
    case "stuck":
      return null;
    case "merged":
      return (
        <Callout tone="ok" icon={GitMerge} title={`Merged into main as ${short(item.commitId)}`}>
          <span className="text-sm text-muted-foreground">Only the merge gate writes main. The fork is done.</span>
        </Callout>
      );
    case "picked":
      return (
        <Callout tone={item.won ? "ok" : "idle"} icon={Trophy} title={item.won ? "This attempt was picked" : `Attempt ${short(item.winner, 9)} was picked`}>
          <span className="text-sm text-muted-foreground">
            {item.candidates.map((c) => `${short(c.sessionId, 9)}${c.sessionId === sessionId ? " (this one)" : ""} passed ${c.passed} of ${c.total}`).join(", ")}
          </span>
          {item.reasons.length ? <span className="text-sm">{item.reasons.join(" ")}</span> : null}
        </Callout>
      );
    case "steered":
      return (
        <div className="flex flex-col items-end gap-1">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap">{item.message}</div>
          <span className="text-[11px] text-muted-foreground">Note for the next turn</span>
        </div>
      );
    default:
      return null;
  }
}

export function Timeline({ items, live, sessionId }: { readonly items: readonly TimelineItem[]; readonly live: boolean; readonly sessionId: string }) {
  const list = blocks(items);
  const lastAgent = list.findLastIndex((b) => b.kind === "agent");
  return (
    <>
      {list.map((block, i) =>
        block.kind === "agent" ? <AgentBlock key={i} block={block} live={live && i === lastAgent && list.slice(i + 1).every((b) => b.kind === "item" && b.item.kind !== "state")} /> : <ItemView key={i} item={block.item} sessionId={sessionId} />,
      )}
      {items.length === 0 ? <ToneBadge tone="idle">No events yet for this session</ToneBadge> : null}
    </>
  );
}

export { Callout };
