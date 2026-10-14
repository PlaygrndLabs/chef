import { useLayoutEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { hideSplash } from "@/lib/boot";
import { cn } from "@/lib/utils";

export function Shown() {
  useLayoutEffect(hideSplash, []);
  return null;
}

function Rows({ count, className }: { readonly count: number; readonly className?: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", className)} style={{ width: `${88 - ((i * 23) % 40)}%` }} />
      ))}
    </>
  );
}

export function ListSkeleton() {
  return (
    <div className="appear-late flex flex-col gap-3 px-2 pt-2" aria-busy="true" aria-label="Loading the work list">
      <Skeleton className="h-3 w-16" />
      <Rows count={4} />
    </div>
  );
}

export function BarSkeleton() {
  return (
    <div className="appear-late flex items-center gap-3 px-2" aria-hidden>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-3.5 w-14" />
      <Skeleton className="h-3.5 w-28" />
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="appear-late flex flex-col gap-6 pt-2" aria-busy="true" aria-label="Loading the conversation">
      <Skeleton className="h-10 w-2/5 self-end rounded-2xl" />
      <div className="flex gap-3">
        <Skeleton className="size-7 shrink-0 rounded-lg" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <div className="appear-late flex h-full flex-col gap-3 p-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="w-full flex-1 rounded-xl" />
    </div>
  );
}

export function ChatViewSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
          <ChatSkeleton />
        </div>
      </div>
      <div className="px-4 pt-2 pb-4 sm:px-6 sm:pb-5" aria-hidden>
        <div className="mx-auto max-w-3xl rounded-2xl border bg-card shadow-xs">
          <div className="min-h-12 px-4 pt-3.5 text-sm text-muted-foreground">Describe a feature or a change</div>
          <div className="h-11" />
        </div>
      </div>
    </div>
  );
}
