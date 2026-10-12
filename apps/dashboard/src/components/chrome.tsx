import { useMemo, useState } from "react";
import { ChevronsUpDown, Hammer, Menu, Monitor, Moon, PanelRight, Search, Sun, Terminal } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FEATURE_TONE, StateBadge, StatusDot, ToneBadge } from "@/components/status";
import { VoiceButton } from "@/components/voice-button";
import { metrics } from "@/lib/events";
import { ago, clock, short } from "@/lib/format";
import { isProjectName } from "@/lib/selection";
import { useNow } from "@/lib/live";
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

function ProjectSwitcher() {
  const { selection, select } = useWorkspace();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const recent = useMemo(() => recentProjects(selection.project), [selection.project]);
  const go = (project: string) => {
    if (!isProjectName(project)) {
      toast.error("Project names use lower case letters, digits and dashes");
      return;
    }
    setOpen(false);
    setName("");
    select({ project, view: "project", feature: null, session: null });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 font-medium" aria-label="Switch project">
          {selection.project}
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
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
        <div className="px-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Recent</div>
        {recent.map((p) => (
          <button key={p} type="button" onClick={() => go(p)} className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted">
            {p}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ThemeMenu() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Theme">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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

export function TopBar({ onPalette, onSidebar, onInspector, compact }: { readonly onPalette: () => void; readonly onSidebar: () => void; readonly onInspector: () => void; readonly compact: boolean }) {
  const { data, selection, feature, session } = useWorkspace();
  const m = metrics(data.live);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
      {compact ? (
        <Button variant="ghost" size="icon-sm" onClick={onSidebar} aria-label="Show the feature map">
          <Menu />
        </Button>
      ) : null}
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-6 place-items-center rounded-md bg-brand text-xs text-brand-foreground">k</span>
        <span className="hidden sm:inline">kargah</span>
      </div>
      <span className="h-5 w-px bg-border" />
      <ProjectSwitcher />
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground md:flex">
        {selection.view === "insights" ? <span>/ Health and memory</span> : null}
        {feature ? <span className="truncate">/ {feature.title}</span> : null}
        {session ? <span className="font-mono">/ {short(session.id, 9)}</span> : null}
      </nav>
      <span className="flex-1" />
      <div className="hidden items-center gap-1.5 lg:flex">
        <ToneBadge tone="ok">
          <StatusDot tone="ok" />
          {m.mergedFeatures} merged
        </ToneBadge>
        <ToneBadge tone={m.running ? "run" : "idle"}>
          <StatusDot tone={m.running ? "run" : "idle"} />
          {m.running} running
        </ToneBadge>
        <ToneBadge tone={m.stuck ? "bad" : "idle"}>
          <StatusDot tone={m.stuck ? "bad" : "idle"} />
          {m.stuck} need you
        </ToneBadge>
        <ToneBadge tone="idle">{Math.round(m.revertRate * 100)}% reverted</ToneBadge>
      </div>
      <Button variant="outline" size="sm" onClick={onPalette} className="text-muted-foreground">
        <Search />
        <span className="hidden sm:inline">Search</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <VoiceButton />
      <ThemeMenu />
      {compact ? (
        <Button variant="ghost" size="icon-sm" onClick={onInspector} aria-label="Show the inspector">
          <PanelRight />
        </Button>
      ) : null}
    </header>
  );
}

const CONNECTION = { live: ["ok", "Live"], polling: ["run", "Polling"], connecting: ["idle", "Connecting"], offline: ["bad", "Offline"] } as const;

export function StatusBar({ events, onEvents }: { readonly events: boolean; readonly onEvents: () => void }) {
  const { data } = useWorkspace();
  const now = useNow(5000);
  const m = metrics(data.live);
  const [tone, label] = CONNECTION[data.connection];
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 overflow-x-auto border-t bg-card px-3 text-xs whitespace-nowrap text-muted-foreground" id="connection" data-connection={data.connection}>
      <span className="flex items-center gap-1.5">
        <StatusDot tone={tone} />
        {label}
      </span>
      <span>{m.running} sessions running</span>
      <span className="font-mono">main {short(data.spec?.commitId) || "none"}</span>
      <span>{data.live.lastAt ? `last event ${ago(data.live.lastAt, now)}` : "no events yet"}</span>
      <span className="flex-1" />
      <button type="button" onClick={onEvents} className="flex items-center gap-1.5 hover:text-foreground" aria-expanded={events}>
        <Terminal className="size-3" />
        {events ? "Hide events" : "Events"}
      </button>
    </footer>
  );
}

export function EventsDrawer() {
  const { data, session, openSession } = useWorkspace();
  const [all, setAll] = useState(false);
  const rows = data.live.log.filter((e) => all || !session || e.sessionId === session.id).slice(-300).reverse();
  return (
    <div className="flex h-56 shrink-0 flex-col border-t bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Events</span>
        <span>{session && !all ? `for ${short(session.id, 9)}` : "for the project"}</span>
        {session ? (
          <button type="button" className="hover:text-foreground" onClick={() => setAll((a) => !a)}>
            {all ? "Only this session" : "Show all"}
          </button>
        ) : null}
        <span className="flex-1" />
        <span>{data.live.log.length} kept</span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-1 font-mono text-[11.5px]">
        {rows.map((e) => (
          <li key={e.seq} className="grid grid-cols-[4.5rem_10rem_6rem_minmax(0,1fr)] gap-3 py-px">
            <span className="text-muted-foreground">{clock(e.at)}</span>
            <span>{e.type}</span>
            {e.sessionId ? (
              <button type="button" className="text-left text-run hover:underline" onClick={() => openSession(e.sessionId)}>
                {short(e.sessionId, 9)}
              </button>
            ) : (
              <span />
            )}
            <span className="truncate text-muted-foreground">{e.summary}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CommandPalette({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { features, sessions, select, openFeature, openSession, focusComposer, api, data, selection } = useWorkspace();
  const { setTheme, resolvedTheme } = useTheme();
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search kargah" description="Jump to a feature or a session, or run an action">
      <CommandInput placeholder="Search features, sessions and actions" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() =>
              run(() => {
                select({ view: "project", feature: null, session: null });
                focusComposer();
              })
            }
          >
            New request
          </CommandItem>
          <CommandItem onSelect={() => run(() => select({ view: "insights", feature: null, session: null }))}>Health and memory</CommandItem>
          <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme</CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                api.bootstrap().then(
                  (r) => {
                    toast.success(r.created ? `Created ${selection.project}` : `${selection.project} already exists`);
                    data.refresh();
                  },
                  (e: unknown) => toast.error("Bootstrap failed", { description: e instanceof Error ? e.message : String(e) }),
                );
              })
            }
          >
            <Hammer />
            Create {selection.project} from the template
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Features">
          {features.map((f) => (
            <CommandItem key={f.id} value={`feature ${f.id} ${f.title}`} onSelect={() => run(() => openFeature(f.id))}>
              <StatusDot tone={FEATURE_TONE[f.status]} />
              {f.title}
              <span className="ml-auto font-mono text-xs text-muted-foreground">{f.id}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Sessions">
          {[...sessions].reverse().map((s) => (
            <CommandItem key={s.id} value={`session ${s.id} ${s.featureId}`} onSelect={() => run(() => openSession(s.id))}>
              <span className="font-mono text-xs">{short(s.id, 9)}</span>
              <span className="truncate text-muted-foreground">{s.featureId}</span>
              <span className="ml-auto">
                <StateBadge state={s.state} />
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
