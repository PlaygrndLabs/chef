import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ResizeHandle, useStoredWidth } from "@/components/resize-handle";
import { ChatViewSkeleton, Shown } from "@/components/loading";
import { preloadSettings, SettingsHost } from "@/components/settings-host";
import { ContextMeter } from "@/components/context-meter";
import { ProjectBar } from "@/components/project-bar";
import { SessionTabs, SessionView } from "@/components/session-tabs";
import { ProjectHeader, TreePane } from "@/components/sidebar";
import { projectApi } from "@/lib/api";
import { preloadable, useOpenedOnce, whenIdle } from "@/lib/lazy";
import { useProject } from "@/lib/live";
import { useMediaQuery, useWindowWidth } from "@/lib/media";
import { currentSession, featureNodes, sessionNodes } from "@/lib/model";
import { rememberProject, returningToNewProject } from "@/lib/projects";
import type { Selection, SettingsScope } from "@/lib/selection";
import { useSettings } from "@/lib/settings";
import { MAIN_TAB, useTabs } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { WorkspaceContext, type TabPlace, type Workspace } from "@/lib/workspace";

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
  if (id === MAIN_TAB) return { view: "main", feature: null, session: null, panel: null };
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
  const features = useMemo(() => featureNodes(data.live, data.records, data.spec?.features ?? [], data.spec?.layout, data.spec?.map ?? null), [data.live, data.version, data.records, data.spec]);
  const picked = selection.session ? (sessions.find((s) => s.id === selection.session) ?? null) : null;
  const featureId = selection.view === "feature" ? (selection.feature ?? picked?.featureId ?? null) : null;
  const feature = featureId ? (features.find((f) => f.id === featureId) ?? null) : null;
  const session = feature ? currentSession(feature, selection.session) : null;
  const compact = useMediaQuery("(max-width: 1023px)");
  const activeTab = selection.view === "main" ? MAIN_TAB : (featureId ?? (selection.view === "feature" ? selection.session : compact ? null : MAIN_TAB));
  const { tabs, close, keep } = useTabs(project, activeTab);
  const places = useRef(new Map<string, TabPlace>());
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
    if (data.ready) keep((id) => features.some((f) => f.id === id));
  }, [data.ready, features, keep]);

  useEffect(() => {
    if (activeTab && activeTab !== MAIN_TAB) places.current.set(activeTab, { session: selection.session, panel: selection.panel, role: selection.role ?? null });
  }, [activeTab, selection.session, selection.panel, selection.role]);

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
      panelExpanded: expanded && (feature !== null || activeTab === MAIN_TAB),
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
        select({ view: "feature", feature: id, session: null, panel: null, ...places.current.get(id) });
        setTreeSheet(false);
      },
      openMain: () => {
        select({ view: "main", feature: null, session: null, panel: null });
        setTreeSheet(false);
      },
      tabs,
      activeTab,
      selectTab: (id) => select({ ...tabPlace(id), ...places.current.get(id) }),
      placeOf: (id) => places.current.get(id),
      closeTab: (id) => {
        places.current.delete(id);
        const next = close(id);
        if (id !== activeTab) return;
        setExpanded(false);
        select(next === MAIN_TAB && compact ? { view: "project", feature: null, session: null, panel: null } : tabPlace(next));
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

  const large = expanded && (feature !== null || activeTab === MAIN_TAB);
  const closeTabs = () => select({ view: "project", feature: null, session: null, panel: null });

  useEffect(() => {
    if (!large && !(compact && activeTab !== null)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector('[role="dialog"]:not([data-large]), [role="menu"], [role="listbox"]')) return;
      if (large) setExpanded(false);
      else closeTabs();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <WorkspaceContext.Provider value={workspace}>
      <Shown />
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1">
          {compact ? null : (
            <aside className="relative shrink-0 border-r" style={{ width: tree }} aria-label="Features">
              <TreePane header />
              <span aria-hidden className="joint top-[42px] -right-px" />
              <span aria-hidden className="joint -right-px -bottom-0.5" />
              <ResizeHandle edge="right" width={tree} min={TREE.min} max={TREE.max} initial={TREE.initial} onResize={setTreeWidth} label="Resize the feature list" />
            </aside>
          )}
          <main
            className={cn(compact ? "fixed inset-0 z-40 bg-background" : "relative min-w-0 flex-1", compact && activeTab === null && "hidden", large && !compact && "fixed inset-4 z-50 overflow-hidden border bg-background shadow-2xl")}
            aria-label="Open features"
            aria-modal={large || undefined}
            role={large ? "dialog" : undefined}
            data-large={large || undefined}
          >
            <SessionTabs bar={!large} {...(compact ? { onClose: closeTabs } : {})} />
          </main>
          <section className={compact ? "relative flex min-h-0 flex-1 flex-col" : "relative shrink-0 border-l"} style={compact ? undefined : { width: chat }} aria-label="Chat">
            <ChatPane {...(compact ? { onMenu: () => setTreeSheet(true) } : {})} />
            {compact ? null : (
              <>
                <span aria-hidden className="joint top-[42px] -left-px" />
                <span aria-hidden className="joint -bottom-0.5 -left-px" />
                <ResizeHandle edge="left" width={chat} min={CHAT.min} max={chatMax} initial={chatInitial(width)} onResize={setChatWidth} label="Resize the chat" />
              </>
            )}
          </section>
        </div>
        <ProjectBar />
      </div>
      {large && !compact ? <div aria-hidden className="fixed inset-0 z-40 bg-black/50" onClick={() => setExpanded(false)} /> : null}
      {compact ? (
        <Sheet open={treeSheet} onOpenChange={setTreeSheet}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Features</SheetTitle>
            <TreePane />
          </SheetContent>
        </Sheet>
      ) : null}
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
