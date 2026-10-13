import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, FolderGit2, KeyRound, Lightbulb, Monitor, Moon, Plus, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FEATURE_LABEL, FEATURE_TONE, StatusDot } from "@/components/status";
import { missingSettings, SettingsDialog, useSettings } from "@/components/settings-dialog";
import { ProjectSettingsDialog } from "@/components/project-settings-dialog";
import { VoiceButton } from "@/components/voice-button";
import { sortFeatures } from "@/lib/model";
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

function SettingsMenu() {
  const { setTheme } = useTheme();
  const { settings, setSettings, available } = useSettings();
  const [providers, setProviders] = useState(false);
  const [projectSettings, setProjectSettings] = useState(false);
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
            Health and memory
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
  const { features, selection, select, openFeature, focusComposer } = useWorkspace();
  const list = sortFeatures(features.filter((f) => f.status !== "dropped" || f.onMain));
  return (
    <div className="flex h-full flex-col gap-4 bg-sidebar px-2.5 py-3 text-sidebar-foreground">
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
      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <div className="px-2 text-xs font-medium text-muted-foreground">Features</div>
        <nav id="features" aria-label="Features" className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
          {list.map((f) => {
            const tone = FEATURE_TONE[f.status];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => openFeature(f.id)}
                data-feature={f.id}
                data-status={f.status}
                aria-current={selection.view === "feature" && selection.feature === f.id ? "page" : undefined}
                className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent", selection.view === "feature" && selection.feature === f.id && "bg-sidebar-accent")}
              >
                <StatusDot tone={tone} />
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
                <span className={cn("shrink-0 text-xs text-muted-foreground", tone === "bad" && "font-medium text-bad")}>{FEATURE_LABEL[f.status]}</span>
              </button>
            );
          })}
          {list.length === 0 ? <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">Your features show up here as chef builds them.</p> : null}
        </nav>
      </div>
      <div className="flex items-center gap-1 border-t pt-2.5">
        <VoiceButton />
        <span className="flex-1" />
        <SettingsMenu />
      </div>
    </div>
  );
}
