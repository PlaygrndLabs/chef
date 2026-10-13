import { Suspense, use, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Shown } from "@/components/loading";
import { MainView, ProjectWorkspace } from "@/components/project-workspace";
import type { AppMode } from "@/lib/api";
import { boot } from "@/lib/boot";
import { preloadable } from "@/lib/lazy";
import { pickProject, rememberProject, useProjects } from "@/lib/projects";
import { useSelection } from "@/lib/selection";

const PlaceScreen = preloadable(() => import("@/components/place-screen").then((m) => m.PlaceScreen));
const Start = preloadable(() => import("@/components/start").then((m) => m.Start));

export function preloadScreen() {
  if (new URLSearchParams(location.search).has("project")) void MainView.preload();
  else void Start.preload();
}

function needsPlace(mode: AppMode): boolean {
  return mode.mode === "local" && (mode.place === null || (mode.place === "computer" && mode.computer?.status !== "ready"));
}

function LoadFailed({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="grid h-dvh place-items-center p-6 text-center" data-view="load-failed">
      <Shown />
      <div className="flex flex-col items-center gap-3">
        <p className="text-muted-foreground">Could not load your projects: {message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

function ConnectedApp({ initial }: { readonly initial: readonly string[] | null }) {
  const [selection, select] = useSelection();
  const { projects, failed, refresh } = useProjects(initial);
  const opened = useCallback(
    (name: string) => {
      rememberProject(name);
      refresh();
      select({ project: name, view: "project", feature: null, session: null, panel: null });
    },
    [refresh, select],
  );
  const open = useCallback(
    (name: string) => {
      rememberProject(name);
      select({ project: name, view: "project", feature: null, session: null, panel: null, settings: null, item: null });
    },
    [select],
  );
  if (projects === null) return failed ? <LoadFailed message={failed} onRetry={refresh} /> : null;
  const project = pickProject(projects, selection.project);
  if (project === null)
    return (
      <Suspense fallback={null}>
        <Start projects={projects} selection={selection} select={select} onOpen={open} onCreated={opened} />
        <Shown />
      </Suspense>
    );
  return <ProjectWorkspace key={project} selection={selection} select={select} projects={projects} onCreated={opened} />;
}

export function App() {
  const start = use(boot());
  const [mode, setMode] = useState(start.mode);
  if (needsPlace(mode))
    return (
      <Suspense fallback={null}>
        <PlaceScreen mode={mode} onChange={setMode} />
        <Shown />
      </Suspense>
    );
  return <ConnectedApp initial={needsPlace(start.mode) ? null : start.projects} />;
}
