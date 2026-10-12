import { useMemo, useState } from "react";
import { ChevronsUpDown, Hammer, Lightbulb, Monitor, Moon, Plus, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FEATURE_LABEL, FEATURE_TONE, StatusDot } from "@/components/status";
import { VoiceButton } from "@/components/voice-button";
import { sortFeatures } from "@/lib/model";
import { isProjectName } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const RECENT = "kargah:projects";

function recentProjects(current: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT) ?? "[]") as string[];
    const next = [current, ...list.filter((p) => p !== current)].slice(0, 8);
    localStorage.setItem(RECENT, JSON.stringify(next));
    return next;
  } catch {
    return [current];
  }
}

const CONNECTION = { live: ["ok", "Live"], polling: ["run", "Reconnecting, updates every few seconds"], connecting: ["idle", "Connecting"], offline: ["bad", "Offline"] } as const;

function ProjectSwitcher() {
  const { selection, select, data } = useWorkspace();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const recent = useMemo(() => recentProjects(selection.project), [selection.project]);
  const [tone, label] = CONNECTION[data.connection];
  const go = (project: string) => {
    if (!isProjectName(project)) {
      toast.error("Project names use lower case letters, digits and dashes");
      return;
    }
    setOpen(false);
    setName("");
    select({ project, view: "project", feature: null, session: null, panel: null });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label="Switch project">
          <span className="truncate">{selection.project}</span>
          <span id="connection" data-connection={data.connection} title={label}>
            <StatusDot tone={tone} />
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(name.trim());
          }}
          className="mb-2"
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Open or create a project" aria-label="Project name" className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
        </form>
        {recent.map((p) => (
          <button key={p} type="button" onClick={() => go(p)} className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted">
            {p}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function SettingsMenu() {
  const { setTheme } = useTheme();
  const { select, api, data, selection } = useWorkspace();
  const bootstrap = () =>
    api.bootstrap().then(
      (r) => {
        toast.success(r.created ? `Created ${selection.project}` : `${selection.project} already exists`);
        data.refresh();
      },
      (e: unknown) => toast.error("Could not create the project", { description: e instanceof Error ? e.message : String(e) }),
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuItem onClick={() => select({ view: "insights", feature: null, session: null, panel: null })}>
          <Lightbulb />
          Health and memory
        </DropdownMenuItem>
        {data.spec && !data.spec.commitId ? (
          <DropdownMenuItem onClick={() => void bootstrap()}>
            <Hammer />
            Create {selection.project} from the template
          </DropdownMenuItem>
        ) : null}
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
  );
}

export function Sidebar() {
  const { features, selection, select, openFeature, focusComposer } = useWorkspace();
  const list = sortFeatures(features.filter((f) => f.status !== "dropped" || f.onMain));
  return (
    <div className="flex h-full flex-col gap-4 bg-sidebar px-2.5 py-3 text-sidebar-foreground">
      <div className="flex items-center gap-1 px-1.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand text-xs font-semibold text-brand-foreground">k</span>
        <span className="pl-1 text-sm font-semibold">kargah</span>
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
          {list.length === 0 ? <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">Your features show up here as kargah builds them.</p> : null}
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
