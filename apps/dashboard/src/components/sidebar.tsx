import { AppWindowMac, BookOpen, Bot, Check, ChevronsUpDown, Cpu, KeyRound, ListTree, Monitor, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/status";
import { FeatureTree, useDropTarget } from "@/components/feature-tree";
import { host } from "@/host";
import { missingSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { LIVE_TAB } from "@/lib/tabs";
import { useWorkspace, type AppSettings } from "@/lib/workspace";
import { Mark, Wordmark } from "@/components/logo";

const useAccount = host.useAccount ?? (() => null);

const CONNECTION = { live: ["ok", "Live"], polling: ["run", "Reconnecting, updates every few seconds"], connecting: ["idle", "Connecting"], offline: ["bad", "Offline"] } as const;

function ProjectSwitcher() {
  const { selection, select, data, projects } = useWorkspace();
  const [tone, label] = CONNECTION[data.connection];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-sidebar-accent" aria-label="Switch project" title={selection.project}>
          <span className="truncate">{selection.project}</span>
          <span id="connection" data-connection={data.connection} title={label}>
            <StatusDot tone={tone} />
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Projects</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem key={p} onClick={() => select({ project: p, view: "project", feature: null, session: null, panel: null, settings: null, item: null })}>
            <span className="min-w-0 flex-1 truncate">{p}</span>
            {p === selection.project ? <Check /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppMenu({ app, onSettings }: { readonly app: AppSettings; readonly onSettings: (section?: string) => void }) {
  const { setTheme } = useTheme();
  const needs = app.available ? missingSettings(app.settings) : [];
  const missing = needs.length > 0;
  const need = needs[0] === "models" ? "Add a model key in Settings" : "Add a previews token in Settings";
  const account = useAccount();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" id="app-menu" className="flex h-12 w-full min-w-0 items-center gap-2 px-3 text-left outline-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent data-[state=open]:bg-sidebar-accent" aria-label="chef menu" title={account ? "Account, settings and help" : "Settings for every project, theme and help"}>
          <Mark className="size-6" />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-xs font-medium" data-current="workspace">{account ? account.title : "Settings"}</span>
            <span className="truncate text-[11px] text-muted-foreground">{missing ? need : account ? account.subtitle : "For every project"}</span>
          </span>
          {missing ? <span className="size-1.5 shrink-0 bg-bad" aria-label={need} title={need} /> : null}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{account ? account.heading : location.host}</DropdownMenuLabel>
        {host.MenuItems ? (
          <>
            <host.MenuItems onSettings={onSettings} />
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onClick={() => onSettings()}>
          <Settings />
          Settings
          <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSettings("models")}>
          <Cpu />
          Models and keys
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSettings("agents")}>
          <Bot />
          Agents and skills
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSettings("environment")}>
          <KeyRound />
          Shared environment
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor />
          System
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="https://github.com/PlaygrndLabs/chef#readme" target="_blank" rel="noreferrer">
            <BookOpen />
            Help and docs
          </a>
        </DropdownMenuItem>
        {host.MenuEnd ? <host.MenuEnd /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectHeader({ onMenu }: { readonly onMenu?: () => void }) {
  const { openSettings, selection } = useWorkspace();
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 dash-b px-3">
      {onMenu ? (
        <Button variant="ghost" size="icon-sm" className="-ml-1.5 shrink-0" onClick={onMenu} aria-label="Show features">
          <ListTree />
        </Button>
      ) : null}
      <a href="/" id="home-link" className="rounded-sm" aria-label="All projects" title="All projects">
        <Wordmark />
      </a>
      <span className="pl-0.5 text-muted-foreground/60">/</span>
      <ProjectSwitcher />
      <span className="flex-1" />
      <Button variant="ghost" size="icon-sm" className={cn("shrink-0 text-muted-foreground", selection.settings?.scope === "project" && "bg-sidebar-accent text-foreground")} onClick={() => openSettings("project")} id="project-settings-button" aria-label="Project settings" title={`Settings for ${selection.project}`}>
        <Settings />
      </Button>
    </div>
  );
}

export function TreePane({ header = false }: { readonly header?: boolean }) {
  const { openSettings, app } = useWorkspace();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {header ? <ProjectHeader /> : null}
      <FeatureTree>
        <AppRow />
      </FeatureTree>
      <div className="shrink-0 dash-t">
        <AppMenu app={app} onSettings={(section) => openSettings("app", section)} />
      </div>
    </div>
  );
}

function AppRow() {
  const { selection, data, activeTab, openLive } = useWorkspace();
  const live = data.spec?.live ?? null;
  const active = activeTab === LIVE_TAB;
  const drop = useDropTarget(null);
  return (
    <div className="shrink-0 px-1.5 pt-1.5" {...drop.props}>
      <button
        type="button"
        id="live-app-row"
        onClick={openLive}
        aria-current={active ? "page" : undefined}
        title={live?.url ? `Open main, live at ${new URL(live.url).host}` : "Open main"}
        className={cn("flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-sidebar-accent", active && "bg-sidebar-accent font-medium", drop.active && "bg-sidebar-accent ring-1 ring-ring ring-inset")}
      >
        <AppWindowMac className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{selection.project}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-normal text-muted-foreground">
          {live?.url ? <span className="size-1.5 bg-ok" aria-label="Live" /> : null}
          main
        </span>
      </button>
    </div>
  );
}
