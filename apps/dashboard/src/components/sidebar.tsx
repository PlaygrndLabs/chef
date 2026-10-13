import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, FolderGit2, KeyRound, Lightbulb, Monitor, Moon, Plus, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/status";
import { missingSettings, SettingsDialog, useSettings } from "@/components/settings-dialog";
import { ProjectSettingsDialog } from "@/components/project-settings-dialog";
import { VoiceButton } from "@/components/voice-button";
import { WorkList } from "@/components/work-list";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const CONNECTION = { live: ["ok", "Live"], polling: ["run", "Reconnecting, updates every few seconds"], connecting: ["idle", "Connecting"], offline: ["bad", "Offline"] } as const;

function ProjectSwitcher() {
  const { selection, select, data, projects, addProject } = useWorkspace();
  const [tone, label] = CONNECTION[data.connection];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label="Switch project">
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
          <DropdownMenuItem key={p} onClick={() => select({ project: p, view: "project", feature: null, session: null, panel: null })}>
            <span className="min-w-0 flex-1 truncate">{p}</span>
            {p === selection.project ? <Check /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={addProject}>
          <Plus />
          Add project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function returningFromGitHub(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get("connect") !== "github") return false;
  params.delete("connect");
  history.replaceState(null, "", `?${params.toString()}`);
  return true;
}

function SettingsMenu() {
  const { setTheme } = useTheme();
  const { settings, setSettings, available } = useSettings();
  const [providers, setProviders] = useState(false);
  const [projectSettings, setProjectSettings] = useState(returningFromGitHub);
  const missing = available && missingSettings(settings).length > 0;
  useEffect(() => {
    if (missing) setProviders(true);
  }, [missing]);
  const { select, api, data, selection, addProject } = useWorkspace();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Settings" className={cn(missing && "text-bad")}>
            <Settings />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-56">
          {available ? (
            <DropdownMenuItem onClick={() => setProviders(true)}>
              <KeyRound />
              Settings
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setProjectSettings(true)}>
            <FolderGit2 />
            Project and repository
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => select({ view: "insights", feature: null, session: null, panel: null })}>
            <Lightbulb />
            Memory and learning
          </DropdownMenuItem>
          <DropdownMenuItem onClick={addProject}>
            <Plus />
            Add project
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
        </DropdownMenuContent>
      </DropdownMenu>
      <ProjectSettingsDialog open={projectSettings} onOpenChange={setProjectSettings} project={selection.project} api={api} onSaved={data.refresh} />
      {available ? <SettingsDialog open={providers} onOpenChange={setProviders} settings={settings} onChange={setSettings} /> : null}
    </>
  );
}

export function Sidebar() {
  const { select, focusComposer } = useWorkspace();
  return (
    <div className="flex h-full flex-col gap-3 bg-sidebar px-2.5 py-3 text-sidebar-foreground">
      <div className="flex items-center gap-1 px-1.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand text-xs font-semibold text-brand-foreground">c</span>
        <span className="pl-1 text-sm font-semibold">chef</span>
        <span className="text-muted-foreground">/</span>
        <ProjectSwitcher />
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
        <VoiceButton />
        <span className="flex-1" />
        <SettingsMenu />
      </div>
    </div>
  );
}
