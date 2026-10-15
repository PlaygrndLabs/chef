import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ResizeHandle, useStoredWidth } from "@/components/resize-handle";
import { ChatViewSkeleton, Shown } from "@/components/loading";
import { preloadSettings, SettingsHost } from "@/components/settings-host";
import { ContextMeter } from "@/components/context-meter";
import { ProjectBar } from "@/components/project-bar";
import { SessionTabs, SessionView, TabContent } from "@/components/session-tabs";
import { ProjectHeader, TreePane } from "@/components/sidebar";
import { projectApi } from "@/lib/api";
import { preloadable, useOpenedOnce, whenIdle } from "@/lib/lazy";
import { useProject } from "@/lib/live";
import { useMediaQuery, useWindowWidth } from "@/lib/media";
import { currentSession, featureNodes, sessionNodes } from "@/lib/model";
import { rememberProject, returningToNewProject } from "@/lib/projects";
import type { Selection, SettingsScope } from "@/lib/selection";
import { useSettings } from "@/lib/settings";
import { LIVE_TAB, useTabs } from "@/lib/tabs";
import { WorkspaceContext, type Workspace } from "@/lib/workspace";

export const MainView = preloadable(() => import("@/components/main-view").then((m) => m.MainView));
const CommandPalette = preloadable(() => import("@/components/command-palette").then((m) => m.CommandPalette));
const NewProjectDialog = preloadable(() => import("@/components/project-setup").then((m) => m.NewProjectDialog));

const CHAT = { share: 0.32, initial: 480, widest: 680, min: 360, max: 900 } as const;

function chatInitial(window: number): number {
  return Math.round(Math.min(Math.max(window * CHAT.share, CHAT.initial), CHAT.widest));
}
const TREE = { initial: 280, min: 240, max: 440 } as const;
const TABS_MIN = 420;
const COMPOSE_DELAY_MS = 50;

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function focusComposerSoon() {
  window.setTimeout(() => window.dispatchEvent(new Event("chef:compose")), COMPOSE_DELAY_MS);
}

function tabPlace(id: string): Partial<Selection> {
  if (id === LIVE_TAB) return { view: "live", feature: null, session: null, panel: null };
  return { view: "feature", feature: id, session: null, panel: null };
}

function titleOf(selection: Selection, featureTitle: string | null): string {
  if (selection.settings) return `${selection.settings.scope === "app" ? "Settings" : `${selection.project} settings`} · chef`;
  if (featureTitle && selection.view === "feature") return `${featureTitle} · chef`;
  return `${selection.project} · chef`;
}

function ChatPane({ onMenu }: { readonly onMenu?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {onMenu ? (
        <ProjectHeader onMenu={onMenu} />
      ) : (
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 dash-b px-4 text-xs text-muted-foreground">
          <span className="kicker">Chat</span>
          <ContextMeter />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<ChatViewSkeleton />}>
          <MainView />
        </Suspense>
      </div>
    </div>
  );
}

export function ProjectWorkspace(props: { readonly selection: Selection; readonly select: (patch: Partial<Selection>) => void; readonly projects: readonly string[]; readonly onCreated: (name: string) => void }) {
  const { selection, projects, select: selectAny, onCreated } = props;
  const project = selection.project;
  const select = useCallback((patch: Partial<Selection>) => selectAny({ project, ...patch }), [selectAny, project]);
  const data = useProject(project);
  const api = useMemo(() => projectApi(project), [project]);
  const sessions = useMemo(() => sessionNodes(data.live, data.records), [data.live, data.version, data.records]);
  const features = useMemo(() => featureNodes(data.live, data.records, data.spec?.features ?? [], data.spec?.layout), [data.live, data.version, data.records, data.spec]);
  const picked = selection.session ? (sessions.find((s) => s.id === selection.session) ?? null) : null;
  const featureId = selection.view === "feature" ? (selection.feature ?? picked?.featureId ?? null) : null;
  const feature = featureId ? (features.find((f) => f.id === featureId) ?? null) : null;
  const session = feature ? currentSession(feature, selection.session) : null;
  const activeTab = selection.view === "live" ? LIVE_TAB : (featureId ?? (selection.view === "feature" ? selection.session : null));
  const { tabs, close, keep } = useTabs(project, activeTab);
  const compact = useMediaQuery("(max-width: 1023px)");
  const width = useWindowWidth();
  const [palette, setPalette] = useState(false);
  const [treeSheet, setTreeSheet] = useState(false);
  const [fromGitHub] = useState(returningToNewProject);
  const [adding, setAdding] = useState(fromGitHub);
  const [expanded, setExpanded] = useState(false);
  const [chatWidth, setChatWidth] = useStoredWidth("chef:chat-width-v2", chatInitial(width));
  const [treeWidth, setTreeWidth] = useStoredWidth("chef:tree-width", TREE.initial);
  const app = useSettings();
  const paletteLoaded = useOpenedOnce(palette);
  const addingLoaded = useOpenedOnce(adding);
  const tree = Math.min(Math.max(treeWidth, TREE.min), TREE.max);
  const chatMax = Math.max(CHAT.min, Math.min(CHAT.max, width - tree - TABS_MIN));
  const chat = Math.min(Math.max(chatWidth, CHAT.min), chatMax);

  useEffect(() => {
    if (data.ready) keep((id) => id === LIVE_TAB || features.some((f) => f.id === id));
  }, [data.ready, features, keep]);

  const openSettings = useCallback(
    (scope: SettingsScope, section = "general", item: string | null = null) => {
      setTreeSheet(false);
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
      panelExpanded: expanded && (feature !== null || activeTab === LIVE_TAB),
      expandPanel: setExpanded,
      addProject: () => {
        setTreeSheet(false);
        setAdding(true);
      },
      openSession: (id) => {
        const node = sessions.find((s) => s.id === id);
        select({ view: "feature", session: id, feature: node?.featureId ?? null, panel: null });
        setTreeSheet(false);
      },
      openFeature: (id) => {
        select({ view: "feature", feature: id, session: null, panel: null });
        setTreeSheet(false);
      },
      openLive: () => {
        select({ view: "live", feature: null, session: null, panel: null });
        setTreeSheet(false);
      },
      tabs,
      activeTab,
      selectTab: (id) => select(tabPlace(id)),
      closeTab: (id) => {
        const next = close(id);
        if (id !== activeTab) return;
        setExpanded(false);
        select(next === null ? { view: "project", feature: null, session: null, panel: null } : tabPlace(next));
      },
      focusComposer: () => {
        setTreeSheet(false);
        if (compact) select({ view: "project", feature: null, session: null, panel: null });
        focusComposerSoon();
      },
      openSettings,
      app,
    }),
    [data, api, selection, select, features, sessions, feature, session, projects, expanded, tabs, activeTab, close, compact, openSettings, app],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (!typing(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n") {
        e.preventDefault();
        focusComposerSoon();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => rememberProject(project), [project]);

  useEffect(() => {
    document.title = titleOf(selection, feature?.title ?? null);
  }, [feature?.title, selection]);

  useEffect(
    () =>
      whenIdle(() => {
        void SessionView.preload();
        void CommandPalette.preload();
        preloadSettings();
      }),
    [],
  );

  const showTabs = !(expanded && (feature !== null || activeTab === LIVE_TAB));
  return (
    <WorkspaceContext.Provider value={workspace}>
      <Shown />
      <div className="flex h-dvh flex-col overflow-hidden">
        {compact ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <ChatPane onMenu={() => setTreeSheet(true)} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <aside className="relative shrink-0 border-r" style={{ width: tree }} aria-label="Features">
              <TreePane header />
              <span aria-hidden className="joint top-[42px] -right-px" />
              <span aria-hidden className="joint -right-px -bottom-0.5" />
              <ResizeHandle edge="right" width={tree} min={TREE.min} max={TREE.max} initial={TREE.initial} onResize={setTreeWidth} label="Resize the feature list" />
            </aside>
            <main className="relative min-w-0 flex-1" aria-label="Open features">
              {showTabs ? <SessionTabs /> : null}
            </main>
            <section className="relative shrink-0 border-l" style={{ width: chat }} aria-label="Chat">
              <ChatPane />
              <span aria-hidden className="joint top-[42px] -left-px" />
              <span aria-hidden className="joint -bottom-0.5 -left-px" />
              <ResizeHandle edge="left" width={chat} min={CHAT.min} max={chatMax} initial={chatInitial(width)} onResize={setChatWidth} label="Resize the chat" />
            </section>
          </div>
        )}
        <ProjectBar />
      </div>
      {compact ? (
        <>
          <Sheet open={treeSheet} onOpenChange={setTreeSheet}>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Features</SheetTitle>
              <TreePane />
            </SheetContent>
          </Sheet>
          <Sheet
            open={activeTab !== null && !expanded}
            onOpenChange={(open) => {
              if (!open) select({ view: "project", feature: null, session: null, panel: null });
            }}
          >
            <SheetContent side="right" className="w-screen max-w-none p-0 data-[side=right]:w-screen data-[side=right]:sm:max-w-none [&>button]:hidden">
              <SheetTitle className="sr-only">Open features</SheetTitle>
              <SessionTabs onClose={() => select({ view: "project", feature: null, session: null, panel: null })} />
            </SheetContent>
          </Sheet>
        </>
      ) : null}
      <Dialog open={expanded && (feature !== null || activeTab === LIVE_TAB)} onOpenChange={setExpanded}>
        <DialogContent showCloseButton={false} className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{feature?.title ?? (activeTab === LIVE_TAB ? "main" : "Feature")}</DialogTitle>
          <TabContent />
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
