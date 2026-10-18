import { Suspense, use, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Shown } from "@/components/loading";
import { MainView, ProjectWorkspace } from "@/components/project-workspace";
import { SessionView } from "@/components/session-tabs";
import { host } from "@/host";
import { boot } from "@/lib/boot";
import { preloadable } from "@/lib/lazy";
import { pickProject, rememberProject, useProjects } from "@/lib/projects";
import { useSelection } from "@/lib/selection";
import type { ProjectEntry } from "@/lib/api";

const Start = preloadable(() => import("@/components/start").then((m) => m.Start));

export function preloadScreen() {
  const params = new URLSearchParams(location.search);
  if (!params.has("project")) return void Start.preload();
  void MainView.preload();
  if (params.has("feature") || params.has("session")) void SessionView.preload();
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

function ConnectedApp({ initial }: { readonly initial: readonly ProjectEntry[] | null }) {
  const [selection, select] = useSelection();
  const { projects, entries, failed, refresh } = useProjects(initial);
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
  if (projects === null || entries === null) return failed ? <LoadFailed message={failed} onRetry={refresh} /> : null;
  const project = pickProject(projects, selection.project);
  if (project === null)
    return (
      <Suspense fallback={null}>
        <Start projects={entries} selection={selection} select={select} onOpen={open} onCreated={opened} />
        <Shown />
      </Suspense>
    );
  return <ProjectWorkspace key={project} selection={selection} select={select} projects={projects} onCreated={opened} />;
}

function Locked() {
  const [selection, select] = useSelection();
  const none = useCallback(() => undefined, []);
  const Content = host.Locked;
  return (
    <Suspense fallback={null}>
      <Start projects={[]} selection={selection} select={select} onOpen={none} onCreated={none} locked={Content ? <Content /> : null} />
      <Shown />
    </Suspense>
  );
}

export function App() {
  const start = use(boot());
  const [locked, setLocked] = useState(start.locked);
  if (locked) return <Locked />;
  const Overlay = host.Overlay;
  return (
    <>
      <ConnectedApp initial={start.projects} />
      {Overlay ? <Overlay onLocked={() => setLocked(true)} /> : null}
    </>
  );
}
