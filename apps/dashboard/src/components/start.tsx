import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight, Folder, Menu, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Wordmark } from "@/components/logo";
import { NewProjectDialog, NewProjectForm } from "@/components/project-setup";
import { MODEL_CHOICES, ProviderForm, type Save } from "@/components/provider-form";
import { settingsApi } from "@/lib/api";
import { missingSettings, useSettings } from "@/lib/settings";
import { AppMenu } from "@/components/sidebar";
import { host } from "@/host";
import { preloadable, useOpenedOnce } from "@/lib/lazy";
import { openedProjects, recentProjects, returningToNewProject, type RecentProject } from "@/lib/projects";
import { ago } from "@/lib/format";
import type { ProjectEntry } from "@/lib/api";
import type { Selection, SettingsScope } from "@/lib/selection";
import type { AppSettings } from "@/lib/workspace";

const SettingsDialog = preloadable(() => import("@/components/settings-dialog").then((m) => m.SettingsDialog));

const RECENT = 6;

function since(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days < 1) return ago(at);
  if (days < 30) return `${days} d ago`;
  return `on ${new Date(at).toLocaleDateString()}`;
}

const HOW = { updated: "Updated", opened: "Opened", created: "Created" } as const;

function StartSidebar(props: { readonly app: AppSettings; readonly onSettings: (section?: string) => void; readonly onNew: (() => void) | null; readonly projects: readonly RecentProject[]; readonly onOpen: (name: string) => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex shrink-0 flex-col gap-3 px-2.5 pt-3">
        <div className="flex h-7 items-center px-0.5">
          <a href="/" aria-label="All projects" title="All projects">
            <Wordmark />
          </a>
        </div>
        {props.onNew ? (
          <Button className="h-9" onClick={props.onNew} id="start-new-project">
            <Plus />
            New project
          </Button>
        ) : null}
      </div>
      {props.projects.length > 0 ? (
        <>
          <div className="kicker shrink-0 px-4 pt-5 pb-1.5">Projects</div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" id="sidebar-projects" aria-label="Projects">
            {props.projects.map((p) => (
              <button key={p.name} type="button" data-project={p.name} onClick={() => props.onOpen(p.name)} title={`Open ${p.name}`} className="flex h-8 w-full min-w-0 items-center gap-2 px-2 text-left text-sm hover:bg-sidebar-accent">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            ))}
          </nav>
        </>
      ) : (
        <span className="flex-1" />
      )}
      <div className="shrink-0 dash-t">
        <AppMenu app={props.app} onSettings={props.onSettings} />
      </div>
    </div>
  );
}

function RecentProjects(props: { readonly projects: readonly RecentProject[]; readonly onOpen: (name: string) => void; readonly onNew: () => void; readonly onAll: () => void }) {
  const recent = props.projects.slice(0, RECENT);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-12 pb-16 sm:px-6 sm:pt-20">
      <div className="flex items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <div className="kicker">Recent</div>
          <h1 className="text-xl font-medium tracking-tight">Pick up where you left off</h1>
        </div>
        <Button onClick={props.onNew} id="recent-new-project" className="shrink-0">
          <Plus />
          New<span className="-ml-1 hidden sm:inline"> project</span>
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2" id="recent-projects">
        {recent.map((p) => (
          <button key={p.name} type="button" data-project={p.name} onClick={() => props.onOpen(p.name)} className="group flex flex-col gap-2 sm:min-h-32 border bg-card p-4 text-left hover:bg-accent">
            <span className="flex min-w-0 items-center gap-2">
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
            </span>
            <span className="line-clamp-2 flex-1 text-sm text-muted-foreground">{p.note ?? "No recent changes"}</span>
            <span className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase" data-how={p.how}>
              {HOW[p.how]} {since(p.at)}
            </span>
          </button>
        ))}
      </div>
      {props.projects.length > recent.length ? (
        <button type="button" onClick={props.onAll} className="kicker w-fit text-brand hover:underline lg:hidden">
          All {props.projects.length} projects
        </button>
      ) : null}
    </div>
  );
}

function ConnectModel(props: { readonly app: ReturnType<typeof useSettings>; readonly first: boolean }) {
  const save: Save = async (update) => {
    try {
      props.app.setSettings(await settingsApi.save(update));
      return true;
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };
  const heading = (
    <>
      <div className="kicker text-brand">{props.first ? "Step 1 of 2" : "One thing first"}</div>
      <h1 className="text-xl font-medium tracking-tight">Connect a model</h1>
    </>
  );
  if (host.ModelKeys)
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 pt-12 pb-16 text-center sm:pt-20" data-onboarding="model">
        {heading}
        <host.ModelKeys onboarding onSaved={() => void settingsApi.get().then(props.app.setSettings, () => undefined)} />
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 pt-12 pb-16 text-center sm:pt-20" data-onboarding="model">
      {heading}
      <p className="text-muted-foreground">Chef plans, writes and reviews code with Claude. Paste your Anthropic API key, or the base URL and key of any Anthropic-compatible provider. The key stays on your Chef.</p>
      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="kicker inline-flex w-fit items-center gap-1 text-brand hover:underline">
        Get an Anthropic API key
        <ArrowUpRight className="size-3.5" />
      </a>
      {host.ModelHelp ? <host.ModelHelp /> : null}
      <div className="mt-4 w-full text-left">
        <ProviderForm part="llm" choices={MODEL_CHOICES} current={null} save={save} submit="Continue" />
      </div>
      <p className="text-xs text-muted-foreground">Models, voice and the rest can be changed later in Settings.</p>
    </div>
  );
}

function FirstProject(props: { readonly fromGitHub: boolean; readonly step: boolean; readonly onCreated: (name: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 pt-12 pb-16 text-center sm:pt-20">
      {props.step ? <div className="kicker text-brand">Step 2 of 2</div> : null}
      <h1 className="text-xl font-medium tracking-tight">Create your first project</h1>
      <p className="text-muted-foreground">Start fresh, or bring a repository you already have and Chef reads it first.</p>
      <div className="mt-4 w-full">
        <NewProjectForm autoFocus fromGitHub={props.fromGitHub} onCreated={props.onCreated} />
      </div>
    </div>
  );
}

export function Start(props: {
  readonly projects: readonly ProjectEntry[];
  readonly selection: Selection;
  readonly select: (patch: Partial<Selection>) => void;
  readonly onOpen: (name: string) => void;
  readonly onCreated: (name: string) => void;
  readonly locked?: ReactNode;
}) {
  const { selection, select } = props;
  const app = useSettings();
  const [fromGitHub] = useState(returningToNewProject);
  const [adding, setAdding] = useState(fromGitHub && props.projects.length > 0);
  const [sidebar, setSidebar] = useState(false);
  const [opened] = useState(openedProjects);
  const recent = useMemo(() => recentProjects(props.projects, opened), [props.projects, opened]);
  const any = props.projects.length > 0;
  const place = selection.settings?.scope === "app" ? selection.settings : null;
  const locked = props.locked !== undefined;
  const needsModel = !locked && app.available && missingSettings(app.settings).includes("models");
  const [onboarding] = useState(() => !any);
  const [stepped, setStepped] = useState(false);
  useEffect(() => {
    if (needsModel) setStepped(true);
  }, [needsModel]);
  const settingsLoaded = useOpenedOnce(place !== null);
  const openSettings = (section?: string, item?: string | null, scope?: SettingsScope) => {
    if (scope === "project") return;
    setSidebar(false);
    select({ settings: { scope: "app", section: section ?? place?.section ?? "general" }, item: item ?? null });
  };
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
    document.title = place ? "Settings · Chef" : "Chef";
  }, [place]);
  const onNew = locked
    ? null
    : any
    ? () => {
        setSidebar(false);
        setAdding(true);
      }
    : null;
  const side = <StartSidebar app={app} onSettings={openSettings} onNew={onNew} projects={locked || needsModel ? [] : recent} onOpen={props.onOpen} />;
  return (
    <div className="flex h-dvh overflow-hidden" data-view={locked ? "locked" : needsModel ? "onboarding" : any ? "start" : "setup"}>
      <aside className="hidden w-64 shrink-0 border-r lg:block" aria-label="chef">
        {side}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebar(true)} aria-label="Show menu">
            <Menu />
          </Button>
          <Wordmark className="h-[17px]" />
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {locked ? (
            props.locked
          ) : app.available && app.settings === null ? null : needsModel ? (
            <ConnectModel app={app} first={onboarding} />
          ) : any ? (
            <RecentProjects projects={recent} onOpen={props.onOpen} onNew={() => setAdding(true)} onAll={() => setSidebar(true)} />
          ) : (
            <FirstProject fromGitHub={fromGitHub} step={stepped && onboarding} onCreated={props.onCreated} />
          )}
        </main>
      </div>
      <Sheet open={sidebar} onOpenChange={setSidebar}>
        <SheetContent side="left" className="w-72 p-0 lg:hidden">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {side}
        </SheetContent>
      </Sheet>
      <NewProjectDialog open={adding} fromGitHub={fromGitHub} onOpenChange={setAdding} onCreated={props.onCreated} />
      {settingsLoaded ? (
        <Suspense fallback={null}>
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
            locked={locked}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
