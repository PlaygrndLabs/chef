import { ChevronRight } from "lucide-react";
import { StateBadge, StatusDot } from "@/components/status";
import type { SessionLive } from "@/lib/events";
import { short, stateTone } from "@/lib/format";
import type { SessionNode } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace";

export function activity(live: SessionLive | undefined): string {
  if (!live) return "";
  if (live.state === "stuck") return live.stuck ?? live.reason;
  if (live.state === "merged") return live.merged ? `Merged as ${short(live.merged)}` : "Merged";
  if (live.state === "dropped") return live.reason;
  for (let i = live.timeline.length - 1; i >= 0; i--) {
    const item = live.timeline[i];
    if (!item) continue;
    if (item.kind === "tool") return `${item.tool} ${item.detail}`.trim();
    if (item.kind === "text") return item.text.trim().split("\n").at(-1)?.slice(0, 140) ?? "";
    if (item.kind === "commit") return `Committed ${short(item.commitId)} (${item.role})`;
    if (item.kind === "review") return item.approve ? "Review approved" : "Review asked for changes";
    if (item.kind === "gate") return item.ok ? "Gate passed" : "Gate failed";
    if (item.kind === "state") return item.reason;
  }
  return "";
}

export function SessionCard({ node, title }: { readonly node: SessionNode; readonly title?: string }) {
  const { openSession } = useWorkspace();
  return (
    <button type="button" onClick={() => openSession(node.id)} data-session={node.id} data-state={node.state} className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left hover:bg-muted/60">
      <StatusDot tone={stateTone(node.state)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm">
          <span className="truncate font-medium">{title ?? node.record?.plan.feature.title ?? node.featureId}</span>
          <span className="font-mono text-xs text-muted-foreground">{short(node.id, 9)}</span>
          {node.attempt && node.attempt.of > 1 ? <span className="text-xs text-muted-foreground">attempt {node.attempt.index}/{node.attempt.of}</span> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{activity(node.live) || "Waiting to start"}</span>
      </span>
      <StateBadge state={node.state} />
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}
