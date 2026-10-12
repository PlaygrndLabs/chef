import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { Loader2 } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CommandPalette, EventsDrawer, StatusBar, TopBar } from "@/components/chrome";
import { FeatureTree } from "@/components/feature-tree";
import { FeatureView } from "@/components/feature-view";
import { Inspector } from "@/components/inspector";
import { InsightsView } from "@/components/insights-view";
import { ProjectChat } from "@/components/project-chat";
import { SessionView } from "@/components/session-view";
import { projectApi } from "@/lib/api";
import { useProject } from "@/lib/live";
import { featureNodes, sessionNodes } from "@/lib/model";
import { useSelection } from "@/lib/selection";
import { WorkspaceContext, type Workspace } from "@/lib/workspace";

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function Center({ workspace }: { readonly workspace: Workspace }) {
  const composer = useRef<HTMLTextAreaElement>(null);
  const { selection, session, feature } = workspace;
  useEffect(() => {
    const focus = () => composer.current?.focus();
    window.addEventListener("kargah:compose", focus);
    return () => window.removeEventListener("kargah:compose", focus);
  }, []);
  if (selection.view === "session") {
    if (session) return <SessionView node={session} composerRef={composer} />;
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          Loading session {selection.session}
        </span>
      </div>
    );
  }
  if (selection.view === "feature" && feature) return <FeatureView node={feature} composerRef={composer} />;
  if (selection.view === "insights") return <InsightsView />;
  return <ProjectChat composerRef={composer} />;
}

export function App() {
  const [selection, select] = useSelection();
  const data = useProject(selection.project);
  const api = useMemo(() => projectApi(selection.project), [selection.project]);
  const sessions = useMemo(() => sessionNodes(data.live, data.records), [data.live, data.version, data.records]);
  const features = useMemo(() => featureNodes(data.live, data.records, data.spec?.features ?? []), [data.live, data.version, data.records, data.spec]);
  const session = selection.session ? (sessions.find((s) => s.id === selection.session) ?? null) : null;
  const featureId = session?.featureId ?? selection.feature;
  const feature = featureId ? (features.find((f) => f.id === featureId) ?? null) : null;
  const compact = useMediaQuery("(max-width: 1023px)");
  const [palette, setPalette] = useState(false);
  const [events, setEvents] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [inspector, setInspector] = useState(false);

  const workspace: Workspace = {
    data,
    api,
    selection,
    select,
    features,
    sessions,
    feature,
    session,
    openSession: (id) => {
      const node = sessions.find((s) => s.id === id);
      select({ view: "session", session: id, feature: node?.featureId ?? null });
      setSidebar(false);
    },
    openFeature: (id) => {
      select({ view: "feature", feature: id, session: null });
      setSidebar(false);
    },
    focusComposer: () => {
      setSidebar(false);
      window.setTimeout(() => window.dispatchEvent(new Event("kargah:compose")), 50);
    },
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (!typing(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n") {
        e.preventDefault();
        select({ view: "project", feature: null, session: null });
        window.setTimeout(() => window.dispatchEvent(new Event("kargah:compose")), 50);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  useEffect(() => {
    document.title = session ? `${session.featureId} · kargah` : feature ? `${feature.title} · kargah` : `${selection.project} · kargah`;
  }, [session, feature, selection.project]);

  return (
    <CopilotKitProvider key={selection.project} runtimeUrl={`/api/projects/${selection.project}/copilotkit`}>
      <WorkspaceContext.Provider value={workspace}>
        <div className="flex h-dvh flex-col overflow-hidden">
          <TopBar onPalette={() => setPalette(true)} onSidebar={() => setSidebar(true)} onInspector={() => setInspector(true)} compact={compact} />
          <div className="min-h-0 flex-1">
            {compact ? (
              <main className="h-full min-w-0">
                <Center workspace={workspace} />
              </main>
            ) : (
              <ResizablePanelGroup orientation="horizontal" id="kargah-layout">
                <ResizablePanel id="sidebar" defaultSize={290} minSize={220} maxSize={460}>
                  <aside className="h-full border-r" aria-label="Feature map">
                    <FeatureTree />
                  </aside>
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel id="center" minSize={420}>
                  <main className="h-full min-w-0 bg-background">
                    <Center workspace={workspace} />
                  </main>
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel id="inspector" defaultSize={420} minSize={320} maxSize={760}>
                  <aside className="h-full border-l" aria-label="Inspector">
                    <Inspector />
                  </aside>
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
          {events ? <EventsDrawer /> : null}
          <StatusBar events={events} onEvents={() => setEvents((e) => !e)} />
        </div>
        {compact ? (
          <>
            <Sheet open={sidebar} onOpenChange={setSidebar}>
              <SheetContent side="left" className="w-80 p-0">
                <SheetTitle className="sr-only">Feature map</SheetTitle>
                <FeatureTree />
              </SheetContent>
            </Sheet>
            <Sheet open={inspector} onOpenChange={setInspector}>
              <SheetContent side="right" className="w-[min(100vw,28rem)] p-0">
                <SheetTitle className="sr-only">Inspector</SheetTitle>
                <Inspector />
              </SheetContent>
            </Sheet>
          </>
        ) : null}
        <CommandPalette open={palette} onOpenChange={setPalette} />
      </WorkspaceContext.Provider>
    </CopilotKitProvider>
  );
}
