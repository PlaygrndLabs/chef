import { useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Wordmark } from "@/components/logo";
import { NewProjectDialog, NewProjectForm } from "@/components/project-setup";
import { SettingsDialog } from "@/components/settings-dialog";
import { missingSettings, useSettings } from "@/lib/settings";
import { AppMenu } from "@/components/sidebar";
import { lastProject, returningToNewProject } from "@/lib/projects";
import type { Selection, SettingsScope } from "@/lib/selection";
import type { AppSettings } from "@/lib/workspace";

function StartSidebar(props: { readonly app: AppSettings; readonly onSettings: (section?: string) => void; readonly onNew: (() => void) | null }) {
  return (
    <div className="flex h-full flex-col gap-3 bg-sidebar px-2.5 py-3 text-sidebar-foreground">
      <div className="flex h-7 items-center px-1.5">
        <a href="/" aria-label="All projects" title="All projects">
          <Wordmark className="h-[15px] translate-y-px" />
        </a>
      </div>
      {props.onNew ? (
        <Button className="h-9" onClick={props.onNew} id="start-new-project">
          <Plus />
          New project
        </Button>
      ) : null}
      <p className="flex-1 px-1.5 text-xs text-muted-foreground">{props.onNew ? "Open a project to see its features and builds here." : null}</p>
      <div className="flex items-center gap-1 border-t pt-2.5">
        <AppMenu app={props.app} onSettings={props.onSettings} />
      </div>
    </div>
  );
}

function ProjectList(props: { readonly projects: readonly string[]; readonly onOpen: (name: string) => void; readonly onNew: () => void }) {
  const last = lastProject();
  const projects = [...props.projects].sort((a, b) => Number(b === last) - Number(a === last));
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-12 pb-16 sm:px-6 sm:pt-20">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Your projects</h1>
        <p className="text-muted-foreground">Open one to keep building.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2" id="project-list">
        {projects.map((name) => (
          <button key={name} type="button" data-project={name} onClick={() => props.onOpen(name)} className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-left hover:bg-accent">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Folder className="size-4" />
            </span>
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{name === last ? "Last opened" : "Project"}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
          </button>
        ))}
        <button type="button" onClick={props.onNew} className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
            <Plus className="size-4" />
          </span>
          <span className="font-medium">New project</span>
        </button>
      </div>
    </div>
  );
}

function FirstProject(props: { readonly fromGitHub: boolean; readonly onCreated: (name: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 pt-12 pb-16 text-center sm:pt-20">
      <h1 className="text-2xl font-semibold tracking-tight">Create your first project</h1>
      <p className="text-muted-foreground">Start fresh, or bring a repository you already have and chef reads it first.</p>
      <div className="mt-4 w-full">
        <NewProjectForm autoFocus fromGitHub={props.fromGitHub} onCreated={props.onCreated} />
      </div>
    </div>
  );
}

export function Start(props: { readonly projects: readonly string[]; readonly selection: Selection; readonly select: (patch: Partial<Selection>) => void; readonly onOpen: (name: string) => void; readonly onCreated: (name: string) => void }) {
  const { selection, select } = props;
  const app = useSettings();
  const [fromGitHub] = useState(returningToNewProject);
  const [adding, setAdding] = useState(fromGitHub && props.projects.length > 0);
  const [sidebar, setSidebar] = useState(false);
  const any = props.projects.length > 0;
  const place = selection.settings?.scope === "app" ? selection.settings : null;
  const missing = app.available ? missingSettings(app.settings) : [];
  const openSettings = (section?: string, item?: string | null, scope?: SettingsScope) => {
    if (scope === "project") return;
    setSidebar(false);
    select({ settings: { scope: "app", section: section ?? place?.section ?? "general" }, item: item ?? null });
  };
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || missing.length === 0) return;
    asked.current = true;
    if (!place) openSettings(missing[0]);
  }, [missing.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    document.title = place ? "Settings · chef" : "chef";
  }, [place]);
  const onNew = any
    ? () => {
        setSidebar(false);
        setAdding(true);
      }
    : null;
  const side = <StartSidebar app={app} onSettings={openSettings} onNew={onNew} />;
  return (
    <div className="flex h-dvh overflow-hidden" data-view={any ? "start" : "setup"}>
      <aside className="hidden w-64 shrink-0 border-r lg:block" aria-label="chef">
        {side}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebar(true)} aria-label="Show menu">
            <Menu />
          </Button>
          <Wordmark className="h-[14px]" />
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">{any ? <ProjectList projects={props.projects} onOpen={props.onOpen} onNew={() => setAdding(true)} /> : <FirstProject fromGitHub={fromGitHub} onCreated={props.onCreated} />}</main>
      </div>
      <Sheet open={sidebar} onOpenChange={setSidebar}>
        <SheetContent side="left" className="w-72 p-0 lg:hidden">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {side}
        </SheetContent>
      </Sheet>
      <NewProjectDialog open={adding} fromGitHub={fromGitHub} onOpenChange={setAdding} onCreated={props.onCreated} />
      <SettingsDialog
        open={place !== null}
        onOpenChange={(open) => (open ? undefined : select({ settings: null, item: null }))}
        settings={app.settings}
        available={app.available}
        onChange={app.setSettings}
        section={place?.section ?? "general"}
        item={selection.item ?? null}
        nav={{ go: (section, item, scope) => openSettings(section, item, scope), section: (section) => openSettings(section) }}
        returnTo="/?settings=app.github"
      />
    </div>
  );
}
