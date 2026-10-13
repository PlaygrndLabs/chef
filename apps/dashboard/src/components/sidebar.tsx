import { BookOpen, Bot, Check, ChevronsUpDown, Cpu, FolderPlus, KeyRound, Mic, Monitor, Moon, Plus, Settings, Settings2, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/status";
import { WorkList } from "@/components/work-list";
import { useTalkButton } from "@/lib/talk";
import { missingSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { Mark, Wordmark } from "@/components/logo";

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

function AppMenu() {
  const { setTheme } = useTheme();
  const { openSettings, app } = useWorkspace();
  const [talk, setTalk] = useTalkButton();
  const missing = app.available && missingSettings(app.settings).length > 0;
  const host = location.host;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" id="app-menu" className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left hover:bg-sidebar-accent" aria-label="chef menu" title="Settings for every project, theme and help">
          <Mark className="size-6 rounded-md" />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-xs font-medium">Settings</span>
            <span className="truncate text-[11px] text-muted-foreground">{missing ? "Needs setup" : "For every project"}</span>
          </span>
          {missing ? <span className="size-1.5 shrink-0 rounded-full bg-bad" aria-label="needs setup" /> : null}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{host}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => openSettings("app")}>
          <Settings />
          Settings
          <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openSettings("app", "models")}>
          <Cpu />
          Models and keys
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openSettings("app", "agents")}>
          <Bot />
          Agents and skills
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openSettings("app", "environment")}>
          <KeyRound />
          Shared environment
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={talk} onCheckedChange={(checked) => setTalk(checked === true)} id="talk-button-toggle">
          <Mic />
          Talk button
        </DropdownMenuCheckboxItem>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar() {
  const { select, focusComposer, addProject, openSettings, selection } = useWorkspace();
  return (
    <div className="flex h-full flex-col gap-3 bg-sidebar px-2.5 py-3 text-sidebar-foreground">
      <div className="flex items-center gap-1 px-1.5">
        <a href="/" id="home-link" className="rounded-sm" aria-label="All projects" title="All projects">
          <Wordmark className="h-[15px] translate-y-px" />
        </a>
        <span className="pl-0.5 text-muted-foreground/60">/</span>
        <ProjectSwitcher />
        <Button variant="ghost" size="icon-sm" className={cn("shrink-0 text-muted-foreground", selection.settings?.scope === "project" && "bg-sidebar-accent text-foreground")} onClick={() => openSettings("project")} id="project-settings-button" aria-label="Project settings" title={`Settings for ${selection.project}`}>
          <Settings2 />
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" onClick={addProject} id="new-project-button" aria-label="New project" title="New project">
          <FolderPlus />
        </Button>
      </div>
      <Button
        className="h-9"
        onClick={() => {
          select({ view: "project", feature: null, session: null, panel: null });
          focusComposer();
        }}
      >
        <Plus />
        New request
      </Button>
      <WorkList />
      <div className="flex items-center gap-1 border-t pt-2.5">
        <AppMenu />
      </div>
    </div>
  );
}
