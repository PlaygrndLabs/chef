import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ResizeHandle, useStoredWidth } from "@/components/resize-handle";
import { ChatViewSkeleton, PageSkeleton, PanelSkeleton, Shown } from "@/components/loading";
import { preloadSettings, SettingsHost } from "@/components/settings-host";
import { ProjectBar } from "@/components/project-bar";
import { Sidebar } from "@/components/sidebar";
import { Wordmark } from "@/components/logo";
import { TalkButton } from "@/components/voice-button";
import { projectApi } from "@/lib/api";
import { preloadable, useOpenedOnce, whenIdle } from "@/lib/lazy";
import { useProject } from "@/lib/live";
import { useMediaQuery, useWindowWidth } from "@/lib/media";
import { featureNodes, sessionNodes } from "@/lib/model";
import { rememberProject, returningToNewProject } from "@/lib/projects";
import type { Selection, SettingsScope } from "@/lib/selection";
import { useSettings } from "@/lib/settings";
import { WorkspaceContext, type Workspace } from "@/lib/workspace";

export const MainView = preloadable(() => import("@/components/main-view").then((m) => m.MainView));
const Panel = preloadable(() => import("@/components/panel").then((m) => m.Panel));
const CommandPalette = preloadable(() => import("@/components/command-palette").then((m) => m.CommandPalette));
const NewProjectDialog = preloadable(() => import("@/components/project-setup").then((m) => m.NewProjectDialog));

const SIDEBAR = { initial: 264, min: 220, max: 440 } as const;
const PANEL = { initial: 480, min: 360 } as const;
const CENTER_MIN = 360;
const COMPOSE_DELAY_MS = 50;

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function focusComposerSoon() {
  window.setTimeout(() => window.dispatchEvent(new Event("chef:compose")), COMPOSE_DELAY_MS);
}

function titleOf(selection: Selection, featureTitle: string | null): string {
  if (selection.settings) return `${selection.settings.scope === "app" ? "Settings" : `${selection.project} settings`} · chef`;
  if (featureTitle && selection.view === "feature") return `${featureTitle} · chef`;
  return `${selection.project} · chef`;
}

function PanelSlot() {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Panel />
    </Suspense>
  );
}

export function ProjectWorkspace(props: { readonly selection: Selection; readonly select: (patch: Partial<Selection>) => void; readonly projects: readonly string[]; readonly onCreated: (name: string) => void }) {
  const { selection, projects, select: selectAny, onCreated } = props;
  const project = selection.project;
  const select = useCallback((patch: Partial<Selection>) => selectAny({ project, ...patch }), [selectAny, project]);
  const data = useProject(project);
  const api = useMemo(() => projectApi(project), [project]);
  const sessions = useMemo(() => sessionNodes(data.live, data.records), [data.live, data.version, data.records]);
  const features = useMemo(() => featureNodes(data.live, data.records, data.spec?.features ?? []), [data.live, data.version, data.records, data.spec]);
  const session = selection.session ? (sessions.find((s) => s.id === selection.session) ?? null) : null;
  const featureId = session?.featureId ?? selection.feature;
  const feature = featureId ? (features.find((f) => f.id === featureId) ?? null) : null;
  const compact = useMediaQuery("(max-width: 1023px)");
  const width = useWindowWidth();
  const [palette, setPalette] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [fromGitHub] = useState(returningToNewProject);
  const [adding, setAdding] = useState(fromGitHub);
  const [expanded, setExpanded] = useState(false);
  const [sideWidth, setSideWidth] = useStoredWidth("chef:sidebar-width", SIDEBAR.initial);
  const [panelWidth, setPanelWidth] = useStoredWidth("chef:panel-width", PANEL.initial);
  const app = useSettings();
  const panel = selection.view === "feature" && feature !== null && selection.panel !== null;
  const panelMax = Math.max(PANEL.min, width - sideWidth - CENTER_MIN);
  const paletteLoaded = useOpenedOnce(palette);
  const addingLoaded = useOpenedOnce(adding);

  const openSettings = useCallback(
    (scope: SettingsScope, section = "general", item: string | null = null) => {
      setSidebar(false);
      select({ settings: { scope, section }, item });
    },
    [select],
  );

  const workspace = useMemo<Workspace>(
    () => ({
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
        focusComposerSoon();
      },
      openSettings,
      app,
    }),
    [data, api, selection, select, features, sessions, feature, session, projects, expanded, panel, openSettings, app],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (!typing(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n") {
        e.preventDefault();
        select({ view: "project", feature: null, session: null, panel: null });
        focusComposerSoon();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  useEffect(() => rememberProject(project), [project]);

  useEffect(() => {
    document.title = titleOf(selection, feature?.title ?? null);
  }, [feature?.title, selection]);

  useEffect(
    () =>
      whenIdle(() => {
        void Panel.preload();
        void CommandPalette.preload();
        preloadSettings();
      }),
    [],
  );

  return (
    <WorkspaceContext.Provider value={workspace}>
      <Shown />
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
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{project}</span>
            </div>
          ) : null}
          <ProjectBar />
          <main className="min-h-0 min-w-0 flex-1">
            <Suspense fallback={selection.view === "project" ? <ChatViewSkeleton /> : <PageSkeleton />}>
              <MainView />
            </Suspense>
          </main>
          <TalkButton />
        </div>
        {panel && !compact && !expanded ? (
          <aside className="relative shrink-0 border-l" style={{ width: Math.min(Math.max(panelWidth, PANEL.min), panelMax) }} aria-label="Preview and details">
            <ResizeHandle edge="left" width={panelWidth} min={PANEL.min} max={panelMax} initial={PANEL.initial} onResize={setPanelWidth} label="Resize the preview" />
            <PanelSlot />
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
          <Sheet
            open={panel && !expanded}
            onOpenChange={(open) => {
              if (!open) select({ panel: null });
            }}
          >
            <SheetContent side="right" className="w-[min(100vw,28rem)] p-0 [&>button]:hidden">
              <SheetTitle className="sr-only">Preview and details</SheetTitle>
              <PanelSlot />
            </SheetContent>
          </Sheet>
        </>
      ) : null}
      <Dialog open={panel && expanded} onOpenChange={setExpanded}>
        <DialogContent showCloseButton={false} className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Preview and details</DialogTitle>
          <PanelSlot />
        </DialogContent>
      </Dialog>
      {paletteLoaded ? (
        <Suspense fallback={null}>
          <CommandPalette open={palette} onOpenChange={setPalette} />
        </Suspense>
      ) : null}
      {addingLoaded ? (
        <Suspense fallback={null}>
          <NewProjectDialog open={adding} fromGitHub={fromGitHub} onOpenChange={setAdding} onCreated={onCreated} />
        </Suspense>
      ) : null}
      <SettingsHost />
    </WorkspaceContext.Provider>
  );
}
