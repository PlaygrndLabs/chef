import { useState } from "react";
import { Bot, ChevronRight } from "lucide-react";
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
              data-group={groupOf(s.state, s.needs)}
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

function Row({ node, depth, closed, toggle }: { readonly node: TreeNode; readonly depth: number; readonly closed: ReadonlySet<string>; readonly toggle: (id: string) => void }) {
  const { selection, feature: active, openFeature } = useWorkspace();
  const agents = useAgents(selection.project);
  const { feature, session } = node;
  const open = !closed.has(feature.id);
  const current = active?.id === feature.id;
  const tone = toneOf(session);
  const role = workingRole(session);
  const single = feature.sessions.length === 1;
  return (
    <li role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-selected={current}>
      <div className={cn("group flex h-8 items-center rounded-md hover:bg-sidebar-accent", current && "bg-sidebar-accent")} style={{ paddingLeft: 4 + depth * INDENT }}>
        {node.children.length ? (
          <button type="button" onClick={() => toggle(feature.id)} className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label={open ? `Hide what is under ${feature.title}` : `Show what is under ${feature.title}`}>
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => openFeature(feature.id)}
          data-feature={feature.id}
          data-status={feature.status}
          data-group={node.group}
          data-state={session.state}
          {...(single ? { "data-session": session.id } : {})}
          aria-current={current ? "page" : undefined}
          title={feature.title}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2 pl-1 text-left text-sm"
        >
          <StatusDot tone={tone} />
          <span className="min-w-0 flex-1 truncate">{feature.title}</span>
          <KindBadges node={session} />
          {role ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-run" data-working-role={role}>
              <Bot className="size-3" />
              {roleLabel(role, agents)}
            </span>
          ) : (
            <span className={cn("shrink-0 text-[11px] text-muted-foreground", tone === "bad" && "font-medium text-bad")}>{stateText(session)}</span>
          )}
        </button>
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

export function FeatureTree() {
  const { features, data, selection } = useWorkspace();
  const [closed, setClosed] = useState(() => readClosed(selection.project));
  const toggle = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      saveClosed(selection.project, next);
      return next;
    });
  const tree = featureTree(features);
  return (
    <nav id="features" aria-label="Features" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2">
      {!data.ready ? (
        <ListSkeleton />
      ) : tree.length ? (
        <ul role="tree" aria-label="Features" className="flex flex-col">
          {tree.map((node) => (
            <Row key={node.feature.id} node={node} depth={0} closed={closed} toggle={toggle} />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">Each thing you ask for in the chat shows up here, and new parts sit under the feature they add to.</p>
      )}
    </nav>
  );
}
