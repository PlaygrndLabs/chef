import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ResizeHandle, useStoredWidth } from "@/components/resize-handle";
import { CommandPalette } from "@/components/command-palette";
import { PlaceScreen } from "@/components/place-screen";
import { FeaturePage } from "@/components/feature-page";
import { Home } from "@/components/home";
import { NewProjectDialog, returningToNewProject } from "@/components/project-setup";
import { Start } from "@/components/start";
import { InsightsView } from "@/components/insights-view";
import { SettingsHost } from "@/components/settings-host";
import { useSettings } from "@/components/settings-dialog";
import { Panel } from "@/components/panel";
import { ProjectBar } from "@/components/project-bar";
import { Sidebar } from "@/components/sidebar";
import { TalkButton } from "@/components/voice-button";
import { appApi, projectApi, type AppMode } from "@/lib/api";
import { useProject } from "@/lib/live";
import { featureNodes, sessionNodes } from "@/lib/model";
import { pickProject, rememberProject, useProjects } from "@/lib/projects";
import { useSelection, type Selection, type SettingsScope } from "@/lib/selection";
import { WorkspaceContext, type Workspace } from "@/lib/workspace";
import { Wordmark } from "@/components/logo";

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

const SIDEBAR = { initial: 264, min: 220, max: 440 } as const;
const PANEL = { initial: 480, min: 360 } as const;

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function Center({ workspace }: { readonly workspace: Workspace }) {
  const composer = useRef<HTMLTextAreaElement>(null);
  const { selection, feature } = workspace;
  useEffect(() => {
    const focus = () => composer.current?.focus();
    window.addEventListener("chef:compose", focus);
    return () => window.removeEventListener("chef:compose", focus);
  }, []);
  if (selection.view === "feature" && feature) return <FeaturePage feature={feature} composerRef={composer} />;
  if (selection.view === "feature") return <div className="grid h-full place-items-center text-muted-foreground">Loading</div>;
  if (selection.view === "insights") return <InsightsView />;
  return <Home composerRef={composer} />;
}

export function App() {
  const [mode, setMode] = useState<AppMode | null>(null);
  useEffect(() => {
    void appApi.get().then(setMode);
  }, []);
  if (mode === null) return <div className="grid h-dvh place-items-center text-muted-foreground">Loading</div>;
  if (mode.mode === "local" && (mode.place === null || (mode.place === "computer" && mode.computer?.status !== "ready"))) return <PlaceScreen mode={mode} onChange={setMode} />;
  return <ConnectedApp />;
}

function ConnectedApp() {
  const [selection, select] = useSelection();
  const { projects, failed, refresh } = useProjects();
  const opened = (name: string) => {
    rememberProject(name);
    refresh();
    select({ project: name, view: "project", feature: null, session: null, panel: null });
  };
  if (projects === null) return <div className="grid h-dvh place-items-center text-muted-foreground">{failed ? `Could not load your projects: ${failed}` : "Loading"}</div>;
  const project = pickProject(projects, selection.project);
  if (project === null) {
    const open = (name: string) => {
      rememberProject(name);
      select({ project: name, view: "project", feature: null, session: null, panel: null, settings: null, item: null });
    };
    return <Start projects={projects} selection={selection} select={select} onOpen={open} onCreated={opened} />;
  }
  return <ProjectWorkspace key={project} selection={project === selection.project ? selection : { ...selection, project }} select={select} projects={projects} onCreated={opened} />;
}

function ProjectWorkspace(props: { readonly selection: Selection; readonly select: (patch: Partial<Selection>) => void; readonly projects: readonly string[]; readonly onCreated: (name: string) => void }) {
  const { selection, projects } = props;
  const select = useCallback((patch: Partial<Selection>) => props.select({ project: selection.project, ...patch }), [props.select, selection.project]);
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
  const [fromGitHub] = useState(returningToNewProject);
  const [adding, setAdding] = useState(fromGitHub);
  const panel = selection.view === "feature" && feature !== null && selection.panel !== null;
  const [expanded, setExpanded] = useState(false);
  const [sideWidth, setSideWidth] = useStoredWidth("chef:sidebar-width", SIDEBAR.initial);
  const [panelWidth, setPanelWidth] = useStoredWidth("chef:panel-width", PANEL.initial);
  const wide = useMediaQuery("(min-width: 1024px)") ? window.innerWidth : 1024;
  const app = useSettings();
  const openSettings = useCallback((scope: SettingsScope, section = scope === "app" ? "general" : "general", item: string | null = null) => {
    setSidebar(false);
    select({ settings: { scope, section }, item });
  }, [select]);
  const panelMax = Math.max(PANEL.min, wide - sideWidth - 360);

  const workspace: Workspace = {
    data,
    api,
    selection,
    select,
    features,
    sessions,
    feature,
    session,
    projects,
    panelExpanded: expanded && panel,
    expandPanel: setExpanded,
    addProject: () => {
      setSidebar(false);
      setAdding(true);
    },
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
      window.setTimeout(() => window.dispatchEvent(new Event("chef:compose")), 50);
    },
    openSettings,
    app,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (!typing(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n") {
        e.preventDefault();
        select({ view: "project", feature: null, session: null, panel: null });
        window.setTimeout(() => window.dispatchEvent(new Event("chef:compose")), 50);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  useEffect(() => rememberProject(selection.project), [selection.project]);

  useEffect(() => {
    document.title = selection.settings ? `${selection.settings.scope === "app" ? "Settings" : `${selection.project} settings`} · chef` : feature && selection.view === "feature" ? `${feature.title} · chef` : `${selection.project} · chef`;
  }, [feature, selection.view, selection.project, selection.settings]);

  return (
    <CopilotKitProvider key={selection.project} runtimeUrl={`/api/projects/${selection.project}/copilotkit`}>
      <WorkspaceContext.Provider value={workspace}>
        <div className="flex h-dvh overflow-hidden">
          {compact ? null : (
            <aside className="relative shrink-0 border-r" style={{ width: Math.min(Math.max(sideWidth, SIDEBAR.min), SIDEBAR.max) }} aria-label="Features">
              <Sidebar />
              <ResizeHandle edge="right" width={sideWidth} min={SIDEBAR.min} max={SIDEBAR.max} initial={SIDEBAR.initial} onResize={setSideWidth} label="Resize the work list" />
            </aside>
          )}
          <div className="relative flex min-w-0 flex-1 flex-col">
            {compact ? (
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
                <Button variant="ghost" size="icon" onClick={() => setSidebar(true)} aria-label="Show features">
                  <Menu />
                </Button>
                <a href="/" aria-label="All projects" title="All projects">
                  <Wordmark className="h-[14px]" />
                </a>
                <span className="text-muted-foreground/60">/</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{selection.project}</span>
              </div>
            ) : null}
            <ProjectBar />
            <main className="min-h-0 min-w-0 flex-1">
              <Center workspace={workspace} />
            </main>
            <TalkButton />
          </div>
          {panel && !compact && !expanded ? (
            <aside className="relative shrink-0 border-l" style={{ width: Math.min(Math.max(panelWidth, PANEL.min), panelMax) }} aria-label="Preview and details">
              <ResizeHandle edge="left" width={panelWidth} min={PANEL.min} max={panelMax} initial={PANEL.initial} onResize={setPanelWidth} label="Resize the preview" />
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
            <Sheet open={panel && !expanded} onOpenChange={(open) => {
                if (!open) select({ panel: null });
              }}>
              <SheetContent side="right" className="w-[min(100vw,28rem)] p-0 [&>button]:hidden">
                <SheetTitle className="sr-only">Preview and details</SheetTitle>
                <Panel />
              </SheetContent>
            </Sheet>
          </>
        ) : null}
        <Dialog open={panel && expanded} onOpenChange={setExpanded}>
          <DialogContent showCloseButton={false} className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" aria-describedby={undefined}>
            <DialogTitle className="sr-only">Preview and details</DialogTitle>
            <Panel />
          </DialogContent>
        </Dialog>
        <CommandPalette open={palette} onOpenChange={setPalette} />
        <SettingsHost />
        <NewProjectDialog open={adding} fromGitHub={fromGitHub} onOpenChange={setAdding} onCreated={props.onCreated} />
      </WorkspaceContext.Provider>
    </CopilotKitProvider>
  );
}
