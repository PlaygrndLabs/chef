import { useMemo, useState } from "react";
import { ChevronRight, FolderTree, GitBranch, Lightbulb, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FEATURE_TONE, StateBadge, StatusDot, ToneBadge } from "@/components/status";
import { short, stateTone } from "@/lib/format";
import { groupFeatures, matches, type FeatureNode } from "@/lib/model";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { isActive } from "@/lib/events";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "stuck", label: "Needs you" },
  { value: "done", label: "Done" },
] as const;

function FeatureRow({ node, open, onToggle }: { readonly node: FeatureNode; readonly open: boolean; readonly onToggle: () => void }) {
  const { selection, openFeature, openSession } = useWorkspace();
  const running = node.sessions.filter((s) => isActive(s.state)).length;
  const selected = selection.view === "feature" && selection.feature === node.id;
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <div className={cn("group flex h-8 items-center gap-1 rounded-md pr-1.5 hover:bg-sidebar-accent", selected && "bg-sidebar-accent")} data-feature={node.id} data-status={node.status}>
        <button type="button" onClick={onToggle} aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`} className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button type="button" onClick={() => openFeature(node.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <StatusDot tone={FEATURE_TONE[node.status]} />
          <span className="min-w-0 flex-1 truncate">{node.title}</span>
          {running ? <span className="text-[11px] text-run">{running} running</span> : node.sessions.length ? <span className="text-[11px] text-muted-foreground">{node.sessions.length}</span> : null}
        </button>
      </div>
      <CollapsibleContent>
        {node.sessions.length === 0 ? <div className="py-1 pl-9 text-xs text-muted-foreground">No sessions yet</div> : null}
        {[...node.sessions].reverse().map((s) => (
          <button
            type="button"
            key={s.id}
            data-session={s.id}
            data-state={s.state}
            onClick={() => openSession(s.id)}
            className={cn("flex h-7 w-full items-center gap-2 rounded-md pr-1.5 pl-9 text-left hover:bg-sidebar-accent", selection.view === "session" && selection.session === s.id && "bg-sidebar-accent")}
          >
            <StatusDot tone={stateTone(s.state)} />
            <span className="font-mono text-xs">{short(s.id, 9)}</span>
            <span className="flex-1 text-xs text-muted-foreground">{s.attempt && s.attempt.of > 1 ? `${s.attempt.index}/${s.attempt.of}` : ""}</span>
            <StateBadge state={s.state} />
          </button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FeatureTree() {
  const { features, data, selection, select, focusComposer } = useWorkspace();
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupFeatures(features.filter((f) => matches(f, filter, query))), [features, filter, query]);
  const stuck = features.filter((f) => f.status === "stuck").length;
  const isOpen = (node: FeatureNode) => toggled[node.id] ?? (node.status === "building" || node.status === "stuck" || node.id === selection.feature);
  return (
    <div className="flex h-full flex-col bg-sidebar text-sm text-sidebar-foreground">
      <div className="flex flex-col gap-2 border-b p-3">
        <Button
          onClick={() => {
            select({ view: "project", feature: null, session: null });
            focusComposer();
          }}
          className="justify-center"
        >
          <Plus />
          New request
          <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">N</Kbd>
        </Button>
        <label className="flex h-8 items-center gap-2 rounded-lg border bg-background px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-3.5" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter features and sessions" aria-label="Filter features and sessions" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => setFilter(v || "all")} variant="outline" size="sm" className="w-full" aria-label="Show">
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="flex-1 text-xs">
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Feature map" className="p-2" id="features">
          <div className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Project</div>
          <button type="button" onClick={() => select({ view: "project", feature: null, session: null })} className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-accent", selection.view === "project" && "bg-sidebar-accent")}>
            <GitBranch className="size-3.5 text-muted-foreground" />
            <span className="flex-1">main</span>
            <span className="font-mono text-xs text-muted-foreground">{short(data.spec?.commitId)}</span>
          </button>
          {groups.map((group) => (
            <div key={group.name}>
              <div className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                <FolderTree className="size-3" />
                {group.name}
              </div>
              {group.features.map((node) => (
                <FeatureRow key={node.id} node={node} open={isOpen(node)} onToggle={() => setToggled((t) => ({ ...t, [node.id]: !isOpen(node) }))} />
              ))}
            </div>
          ))}
          {groups.length === 0 ? <p className="px-2 py-6 text-center text-xs text-muted-foreground">{features.length ? "Nothing matches this filter." : "No features yet. Send a request to start the first one."}</p> : null}
        </nav>
      </ScrollArea>
      <div className="flex flex-col gap-0.5 border-t p-2">
        <button type="button" onClick={() => setFilter("stuck")} className="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-accent">
          <StatusDot tone={stuck ? "bad" : "idle"} />
          <span className="flex-1">Needs you</span>
          <ToneBadge tone={stuck ? "bad" : "idle"}>{stuck}</ToneBadge>
        </button>
        <button type="button" onClick={() => select({ view: "insights", feature: null, session: null })} className={cn("flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-accent", selection.view === "insights" && "bg-sidebar-accent")}>
          <Lightbulb className="size-3.5 text-muted-foreground" />
          <span className="flex-1">Health and memory</span>
          <span className="text-[11px] text-muted-foreground">{data.live.lessons.length} lessons · {data.live.rules.length} rules</span>
        </button>
      </div>
    </div>
  );
}
