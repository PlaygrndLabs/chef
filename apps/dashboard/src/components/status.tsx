import type { SessionState } from "@chef/core";
import { cn } from "@/lib/utils";
import { STATE_LABEL, stateTone, type Tone } from "@/lib/format";
import { isChore, isHotfix, type FeatureStatus, type SessionNode } from "@/lib/model";

const DOT: Readonly<Record<Tone, string>> = {
  run: "bg-run pulse-run",
  ok: "bg-ok",
  bad: "bg-bad",
  idle: "border border-muted-foreground bg-transparent",
  gone: "bg-border",
};

const BADGE: Readonly<Record<Tone, string>> = {
  run: "border-run/30 bg-run/10 text-run",
  ok: "border-ok/30 bg-ok/10 text-ok",
  bad: "border-bad/30 bg-bad/10 text-bad",
  idle: "border-border text-muted-foreground",
  gone: "border-border text-muted-foreground line-through",
};

export function StatusDot({ tone, className }: { readonly tone: Tone; readonly className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0", DOT[tone], className)} />;
}

export function ToneBadge({ tone, children, className }: { readonly tone: Tone; readonly children: React.ReactNode; readonly className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border px-1.5 text-[11.5px] font-medium whitespace-nowrap", BADGE[tone], className)}>{children}</span>;
}

export function StateBadge({ state, dot = false }: { readonly state: SessionState; readonly dot?: boolean }) {
  const tone = stateTone(state);
  return (
    <ToneBadge tone={tone}>
      {dot ? <StatusDot tone={tone} /> : null}
      {STATE_LABEL[state]}
    </ToneBadge>
  );
}

export const FEATURE_TONE: Readonly<Record<FeatureStatus, Tone>> = { building: "run", ready: "run", stuck: "bad", merged: "ok", done: "ok", proposed: "idle", dropped: "gone" };
export const FEATURE_LABEL: Readonly<Record<FeatureStatus, string>> = { building: "Building", ready: "Ready to merge", stuck: "Needs you", merged: "Live", done: "Done", proposed: "Not built yet", dropped: "Stopped" };

const PILL: Readonly<Record<Tone, string>> = {
  run: "bg-run/10 text-run",
  ok: "bg-ok/10 text-ok",
  bad: "bg-bad/10 text-bad",
  idle: "bg-muted text-muted-foreground",
  gone: "bg-muted text-muted-foreground",
};

export function StatusPill({ status, className }: { readonly status: FeatureStatus; readonly className?: string }) {
  const tone = FEATURE_TONE[status];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 px-2.5 text-xs font-medium whitespace-nowrap", PILL[tone], className)}>
      <StatusDot tone={tone} />
      {FEATURE_LABEL[status]}
    </span>
  );
}

export function KindBadges({ node }: { readonly node: SessionNode }) {
  return (
    <>
      {isHotfix(node) ? (
        <span className="contents" data-hotfix>
          <ToneBadge tone="bad" className="h-4 px-1 text-[10.5px]">
            hotfix
          </ToneBadge>
        </span>
      ) : null}
      {isChore(node) ? (
        <span className="contents" data-chore>
          <ToneBadge tone="idle" className="h-4 px-1 text-[10.5px]">
            chore
          </ToneBadge>
        </span>
      ) : null}
    </>
  );
}
