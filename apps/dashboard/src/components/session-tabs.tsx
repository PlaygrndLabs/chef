import { Suspense } from "react";
import { AppWindowMac, X } from "lucide-react";
import { PanelSkeleton } from "@/components/loading";
import { MapMarkIcon } from "@/components/map-mark";
import { StatusDot } from "@/components/status";
import { stateTone } from "@/lib/format";
import { preloadable } from "@/lib/lazy";
import { currentSession, waitsForKey } from "@/lib/model";
import { MAIN_TAB } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

export const SessionView = preloadable(() => import("@/components/session-view").then((m) => m.SessionView));
export const MainTabView = preloadable(() => import("@/components/main-tab").then((m) => m.MainTab));
export const FeatureView = preloadable(() => import("@/components/feature-view").then((m) => m.FeatureView));

function Tab({ id }: { readonly id: string }) {
  const { features, activeTab, selectTab, closeTab } = useWorkspace();
  const feature = id === MAIN_TAB ? null : features.find((f) => f.id === id);
  const node = feature ? currentSession(feature) : null;
  const title = id === MAIN_TAB ? "main" : (feature?.title ?? id);
  const active = activeTab === id;
  return (
    <div role="presentation" className={cn("group flex h-full max-w-56 min-w-0 shrink-0 items-center border-r", active ? "bg-background shadow-[inset_0_2px_0_var(--brand)]" : "bg-sidebar text-muted-foreground hover:text-foreground")}>
      <button type="button" role="tab" aria-selected={active} data-tab={id} onClick={() => selectTab(id)} title={title} className={cn("flex h-full min-w-0 items-center gap-2 pr-1 pl-3 text-[13px]", active && "font-medium")}>
        {id === MAIN_TAB ? <AppWindowMac className="size-3.5 shrink-0 text-muted-foreground" /> : node ? <StatusDot tone={waitsForKey(node) ? "bad" : stateTone(node.state)} /> : feature ? <MapMarkIcon mark={feature.mark} /> : <StatusDot tone="idle" />}
        <span className="truncate">{title}</span>
      </button>
      {id === MAIN_TAB ? (
        <span className="w-2 shrink-0" />
      ) : (
        <button type="button" onClick={() => closeTab(id)} aria-label={`Close ${title}`} className={cn("mr-1.5 grid size-5 shrink-0 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground", !active && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function TabContent() {
  const { activeTab, feature, data } = useWorkspace();
  if (!data.ready) return <PanelSkeleton />;
  if (activeTab === null || activeTab === MAIN_TAB)
    return (
      <Suspense fallback={<PanelSkeleton />}>
        <MainTabView />
      </Suspense>
    );
  if (!feature) return <Missing />;
  if (feature.sessions.length === 0)
    return (
      <Suspense fallback={<PanelSkeleton />}>
        <FeatureView key={feature.id} feature={feature} />
      </Suspense>
    );
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <SessionView key={feature.id} feature={feature} />
    </Suspense>
  );
}

function Missing() {
  return (
    <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground" data-view="missing">
      This feature is not in the project anymore.
    </div>
  );
}

export function SessionTabs({ onClose }: { readonly onClose?: () => void }) {
  const { tabs } = useWorkspace();
  return (
    <div className="flex h-full min-h-0 flex-col" id="sessions">
      <div role="tablist" aria-label="Open features" className="flex h-11 shrink-0 items-stretch overflow-x-auto dash-b bg-sidebar">
        {tabs.map((id) => (
          <Tab key={id} id={id} />
        ))}
        <span className="flex-1" />
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Back to the chat" className="grid w-10 shrink-0 place-items-center text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <TabContent />
      </div>
    </div>
  );
}
