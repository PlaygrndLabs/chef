import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CommandPalette } from "@/components/command-palette";
import { FeaturePage } from "@/components/feature-page";
import { Home } from "@/components/home";
import { InsightsView } from "@/components/insights-view";
import { Panel } from "@/components/panel";
import { Sidebar } from "@/components/sidebar";
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
  const { selection, feature } = workspace;
  useEffect(() => {
    const focus = () => composer.current?.focus();
    window.addEventListener("kargah:compose", focus);
    return () => window.removeEventListener("kargah:compose", focus);
  }, []);
  if (selection.view === "feature" && feature) return <FeaturePage feature={feature} composerRef={composer} />;
  if (selection.view === "feature") return <div className="grid h-full place-items-center text-muted-foreground">Loading</div>;
  if (selection.view === "insights") return <InsightsView />;
  return <Home composerRef={composer} />;
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
  const [sidebar, setSidebar] = useState(false);
  const panel = selection.view === "feature" && feature !== null && selection.panel !== null;

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
      select({ view: "feature", session: id, feature: node?.featureId ?? null });
      setSidebar(false);
    },
    openFeature: (id) => {
      select({ view: "feature", feature: id, session: null, panel: null });
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
        select({ view: "project", feature: null, session: null, panel: null });
        window.setTimeout(() => window.dispatchEvent(new Event("kargah:compose")), 50);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  useEffect(() => {
    document.title = feature && selection.view === "feature" ? `${feature.title} · kargah` : `${selection.project} · kargah`;
  }, [feature, selection.view, selection.project]);

  return (
    <CopilotKitProvider key={selection.project} runtimeUrl={`/api/projects/${selection.project}/copilotkit`}>
      <WorkspaceContext.Provider value={workspace}>
        <div className="flex h-dvh overflow-hidden">
          {compact ? null : (
            <aside className="w-66 shrink-0 border-r" aria-label="Features">
              <Sidebar />
            </aside>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            {compact ? (
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
                <Button variant="ghost" size="icon" onClick={() => setSidebar(true)} aria-label="Show features">
                  <Menu />
                </Button>
                <span className="grid size-6 place-items-center rounded-md bg-brand text-xs font-semibold text-brand-foreground">k</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{selection.project}</span>
              </div>
            ) : null}
            <main className="min-h-0 min-w-0 flex-1">
              <Center workspace={workspace} />
            </main>
          </div>
          {panel && !compact ? (
            <aside className="w-[440px] shrink-0 border-l" aria-label="Preview and details">
              <Panel />
            </aside>
          ) : null}
        </div>
        {compact ? (
          <>
            <Sheet open={sidebar} onOpenChange={setSidebar}>
              <SheetContent side="left" className="w-72 p-0">
                <SheetTitle className="sr-only">Features</SheetTitle>
                <Sidebar />
              </SheetContent>
            </Sheet>
            <Sheet open={panel} onOpenChange={(open) => {
                if (!open) select({ panel: null });
              }}>
              <SheetContent side="right" className="w-[min(100vw,28rem)] p-0 [&>button]:hidden">
                <SheetTitle className="sr-only">Preview and details</SheetTitle>
                <Panel />
              </SheetContent>
            </Sheet>
          </>
        ) : null}
        <CommandPalette open={palette} onOpenChange={setPalette} />
      </WorkspaceContext.Provider>
    </CopilotKitProvider>
  );
}
