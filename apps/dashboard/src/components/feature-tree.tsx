import { createContext, useContext, useState } from "react";
import { Bot, ChevronRight, CornerDownRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ListSkeleton } from "@/components/loading";
import { KindBadges, StatusDot } from "@/components/status";
import { roleLabel, useAgents, workingRole } from "@/lib/agents";
import { PLAIN_STATE, stateTone, type Tone } from "@/lib/format";
import { featureTree, groupOf, heldBy, waitsForKey, type SessionNode, type TreeNode } from "@/lib/model";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const INDENT = 14;

function toneOf(node: SessionNode): Tone {
  return waitsForKey(node) ? "bad" : stateTone(node.state);
}

function stateText(node: SessionNode): string {
  if (waitsForKey(node)) return "Needs a key";
  if (heldBy(node)) return "Waiting";
  return PLAIN_STATE[node.state];
}

function readClosed(project: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`chef:tree-closed:${project}`) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveClosed(project: string, closed: ReadonlySet<string>) {
  try {
    localStorage.setItem(`chef:tree-closed:${project}`, JSON.stringify([...closed]));
  } catch {
    return;
  }
}

function buildLabel(node: SessionNode, index: number, count: number): string {
  if (node.attempt && node.attempt.of > 1) return `Try ${node.attempt.index} of ${node.attempt.of}`;
  return index === count - 1 ? "Latest build" : `Build ${index + 1}`;
}

function Builds({ node, depth }: { readonly node: TreeNode; readonly depth: number }) {
  const { session, openSession } = useWorkspace();
  const list = node.feature.sessions;
  return (
    <ul role="group" className="flex flex-col">
      {[...list].reverse().map((s) => {
        const index = list.indexOf(s);
        const tone = toneOf(s);
        return (
          <li key={s.id} role="treeitem" aria-selected={session?.id === s.id}>
            <button
              type="button"
              onClick={() => openSession(s.id)}
              data-session={s.id}
              data-state={s.state}
              data-group={groupOf(s.state, s.needs, s.budget)}
              className={cn("flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground", session?.id === s.id && "text-foreground")}
              style={{ paddingLeft: 8 + (depth + 1) * INDENT + 14 }}
            >
              <StatusDot tone={tone} className="size-1.5" />
              <span className="min-w-0 flex-1 truncate">{buildLabel(s, index, list.length)}</span>
              <span className="font-mono text-[10.5px]">{s.id}</span>
              <span className={cn("shrink-0", tone === "bad" && "text-bad", tone === "run" && "text-run")}>{stateText(s)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const DRAG_TYPE = "application/x-chef-feature";

interface TreeActions {
  readonly renaming: string | null;
  readonly rename: (id: string | null) => void;
  readonly saveTitle: (node: TreeNode, title: string) => void;
  readonly move: (id: string, parent: string | null) => void;
  readonly askDelete: (node: TreeNode) => void;
  readonly targets: (node: TreeNode) => readonly TreeNode[];
  readonly nodeOf: (id: string) => TreeNode | undefined;
  readonly dragging: string | null;
  readonly setDragging: (id: string | null) => void;
  readonly over: string | null;
  readonly setOver: (id: string | null) => void;
}

const ActionsContext = createContext<TreeActions | null>(null);

function useActions(): TreeActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("tree actions need the feature tree");
  return actions;
}

function flatten(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function failed(what: string) {
  return (error: unknown) => toast.error(what, { description: error instanceof Error ? error.message : String(error) });
}

export function useDropTarget(parent: string | null) {
  const { dragging, targets, nodeOf, move, over, setOver } = useActions();
  const key = parent ?? "";
  const node = dragging ? nodeOf(dragging) : undefined;
  const allowed = node !== undefined && node.feature.parent !== parent && (parent === null || targets(node).some((t) => t.feature.id === parent));
  return {
    active: allowed && over === key,
    props: {
      onDragOver: (event: React.DragEvent) => {
        if (!allowed) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (over !== key) setOver(key);
      },
      onDragLeave: () => {
        if (over === key) setOver(null);
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        setOver(null);
        if (allowed && dragging) move(dragging, parent);
      },
    },
  };
}

function TopLevelDrop() {
  const { dragging, nodeOf } = useActions();
  const drop = useDropTarget(null);
  if (!dragging || !nodeOf(dragging)?.feature.parent) return null;
  return (
    <div {...drop.props} data-drop="top-level" className={cn("mt-1 flex h-8 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground", drop.active && "border-ring bg-sidebar-accent text-foreground")}>
      Drop here to move to the top level
    </div>
  );
}

function TitleField({ node }: { readonly node: TreeNode }) {
  const { saveTitle, rename } = useActions();
  const [value, setValue] = useState(node.feature.title);
  const done = () => (value.trim() && value.trim() !== node.feature.title ? saveTitle(node, value.trim()) : rename(null));
  return (
    <input
      autoFocus
      aria-label={`New name for ${node.feature.title}`}
      value={value}
      maxLength={120}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") done();
        else if (e.key === "Escape") rename(null);
      }}
      className="h-6 min-w-0 flex-1 border border-ring bg-background px-1.5 text-sm outline-none"
    />
  );
}

function RowMenu({ node }: { readonly node: TreeNode }) {
  const { rename, move, askDelete, targets } = useActions();
  const { feature } = node;
  const places = targets(node);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`More for ${feature.title}`} className="grid size-6 shrink-0 place-items-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100">
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => rename(feature.id)}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={places.length === 0 && !feature.parent}>
            <CornerDownRight className="size-4 text-muted-foreground" />
            Move under
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {feature.parent ? <DropdownMenuItem onSelect={() => move(feature.id, null)}>Top level</DropdownMenuItem> : null}
            {places.map((t) => (
              <DropdownMenuItem key={t.feature.id} disabled={t.feature.id === feature.parent} onSelect={() => move(feature.id, t.feature.id)}>
                <span className="truncate">{t.feature.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => askDelete(node)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ node, depth, closed, toggle }: { readonly node: TreeNode; readonly depth: number; readonly closed: ReadonlySet<string>; readonly toggle: (id: string) => void }) {
  const { selection, feature: active, openFeature } = useWorkspace();
  const { renaming, rename, askDelete, setDragging } = useActions();
  const agents = useAgents(selection.project);
  const drop = useDropTarget(node.feature.id);
  const { feature, session } = node;
  const open = !closed.has(feature.id);
  const current = active?.id === feature.id;
  const tone = toneOf(session);
  const role = workingRole(session);
  const single = feature.sessions.length === 1;
  return (
    <li role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-selected={current}>
      <div
        {...drop.props}
        draggable={renaming !== feature.id}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, feature.id);
          event.dataTransfer.effectAllowed = "move";
          setDragging(feature.id);
        }}
        onDragEnd={() => setDragging(null)}
        className={cn("group flex h-8 items-center rounded-md hover:bg-sidebar-accent", current && "bg-sidebar-accent", drop.active && "bg-sidebar-accent ring-1 ring-ring ring-inset")}
        style={{ paddingLeft: 4 + depth * INDENT }}
      >
        {node.children.length ? (
          <button type="button" onClick={() => toggle(feature.id)} className="grid size-5 shrink-0 place-items-center text-muted-foreground hover:text-foreground" aria-label={open ? `Hide what is under ${feature.title}` : `Show what is under ${feature.title}`}>
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        {renaming === feature.id ? (
          <div className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2 pl-1">
            <StatusDot tone={tone} />
            <TitleField node={node} />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => openFeature(feature.id)}
              onDoubleClick={() => rename(feature.id)}
              onKeyDown={(e) => {
                if (e.key === "F2") {
                  e.preventDefault();
                  rename(feature.id);
                } else if (e.key === "Delete") {
                  e.preventDefault();
                  askDelete(node);
                }
              }}
              data-feature={feature.id}
              data-status={feature.status}
              data-group={node.group}
              data-state={session.state}
              {...(single ? { "data-session": session.id } : {})}
              aria-current={current ? "page" : undefined}
              title={feature.title}
              className="flex h-full min-w-0 flex-1 items-center gap-2 pr-1 pl-1 text-left text-sm"
            >
              <StatusDot tone={tone} />
              <span className="min-w-0 flex-1 truncate">{feature.title}</span>
              <KindBadges node={session} />
              {role ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-run group-hover:hidden" data-working-role={role}>
                  <Bot className="size-3" />
                  {roleLabel(role, agents)}
                </span>
              ) : (
                <span className={cn("shrink-0 text-[11px] text-muted-foreground group-hover:hidden", tone === "bad" && "font-medium text-bad")}>{stateText(session)}</span>
              )}
            </button>
            <span className="pr-1">
              <RowMenu node={node} />
            </span>
          </>
        )}
      </div>
      {current && !single ? <Builds node={node} depth={depth} /> : null}
      {open && node.children.length ? (
        <ul role="group" className="flex flex-col">
          {node.children.map((child) => (
            <Row key={child.feature.id} node={child} depth={depth + 1} closed={closed} toggle={toggle} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DeleteDialog({ node, onOpenChange }: { readonly node: TreeNode | null; readonly onOpenChange: (open: boolean) => void }) {
  const { api, data } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const parts = node ? flatten(node.children) : [];
  const live = node ? [node, ...parts].some((n) => n.feature.onMain) : false;
  const remove = async () => {
    if (!node) return;
    setBusy(true);
    try {
      await api.removeFeature(node.feature.id);
      data.refresh();
      onOpenChange(false);
    } catch (error) {
      failed(`Could not delete "${node.feature.title}"`)(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={node !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {node?.feature.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {parts.length ? `Its ${parts.length === 1 ? "part" : `${parts.length} parts`} ${parts.map((p) => p.feature.title).join(", ")} ${parts.length === 1 ? "goes" : "go"} too. ` : ""}
            {live ? "chef stops any work on it and takes its code out of the live app." : "chef stops the work on it."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            {busy ? "Deleting" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FeatureTree({ children }: { readonly children?: React.ReactNode }) {
  const { features, data, selection, api } = useWorkspace();
  const [closed, setClosed] = useState(() => readClosed(selection.project));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TreeNode | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const toggle = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      saveClosed(selection.project, next);
      return next;
    });
  const tree = featureTree(features);
  const all = flatten(tree);
  const actions: TreeActions = {
    renaming,
    rename: setRenaming,
    saveTitle: (node, title) => {
      setRenaming(null);
      api.arrange(node.feature.id, { title }).then(data.refresh, failed(`Could not rename "${node.feature.title}"`));
    },
    move: (id, parent) => {
      setDragging(null);
      if (parent && closed.has(parent)) toggle(parent);
      api.arrange(id, { parent }).then(data.refresh, failed("Could not move the feature"));
    },
    askDelete: setDeleting,
    targets: (node) => {
      const own = new Set(flatten([node]).map((n) => n.feature.id));
      return all.filter((n) => !own.has(n.feature.id));
    },
    nodeOf: (id) => all.find((n) => n.feature.id === id),
    dragging,
    setDragging: (id) => {
      setDragging(id);
      if (id === null) setOver(null);
    },
    over,
    setOver,
  };
  return (
    <ActionsContext.Provider value={actions}>
      {children}
      <nav id="features" aria-label="Features" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2">
        {!data.ready ? (
          <ListSkeleton />
        ) : tree.length ? (
          <>
            <ul role="tree" aria-label="Features" className="flex flex-col">
              {tree.map((node) => (
                <Row key={node.feature.id} node={node} depth={0} closed={closed} toggle={toggle} />
              ))}
            </ul>
            <TopLevelDrop />
          </>
        ) : (
          <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">Each thing you ask for in the chat shows up here, and new parts sit under the feature they add to.</p>
        )}
      </nav>
      <DeleteDialog node={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
    </ActionsContext.Provider>
  );
}
