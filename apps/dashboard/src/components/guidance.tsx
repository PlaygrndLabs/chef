import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { MemoryEntry } from "@chef/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Group } from "@/components/settings-shell";
import { ToneBadge } from "@/components/status";
import { sharedInstructionsApi, type InstructionsView, type MemoryView, type ProjectApi } from "@/lib/api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(task: () => Promise<T>, done: string, failed = "Could not save"): Promise<T | null> => {
    setBusy(true);
    try {
      const result = await task();
      toast.success(done);
      return result;
    } catch (e) {
      toast.error(failed, { description: message(e) });
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Loading() {
  return <p className="text-xs text-muted-foreground">Loading…</p>;
}

function SaveRow(props: { readonly busy: boolean; readonly dirty: boolean; readonly children?: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {props.children}
      <Button type="submit" size="sm" disabled={props.busy || !props.dirty}>
        {props.busy ? <Loader2 className="animate-spin" /> : null}
        Save
      </Button>
    </div>
  );
}

export function SharedInstructionsForm() {
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const { busy, run } = useBusy();
  useEffect(() => {
    sharedInstructionsApi.get().then(
      (view) => {
        setSaved(view.text);
        setText(view.text);
      },
      (e: unknown) => toast.error("Could not load the instructions", { description: message(e) }),
    );
  }, []);
  if (saved === null) return <Loading />;
  return (
    <form
      id="shared-instructions"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => sharedInstructionsApi.save(text, saved), "Saved").then((view) => {
          if (!view) return;
          setSaved(view.text);
          setText(view.text);
        });
      }}
    >
      <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Instructions for every project" placeholder={"For example:\nUse Tailwind and shadcn/ui for every page.\nWrite friendly, short copy.\nEvery form shows a clear error next to the field."} className="max-h-[60vh] min-h-48 overflow-y-auto font-mono text-xs leading-relaxed md:text-xs" />
      <SaveRow busy={busy} dirty={text.trim() !== saved} />
    </form>
  );
}

export function ProjectInstructionsForm(props: { readonly api: ProjectApi; readonly onEditShared: () => void }) {
  const [view, setView] = useState<InstructionsView | null>(null);
  const [goal, setGoal] = useState("");
  const [instructions, setInstructions] = useState("");
  const { busy, run } = useBusy();
  const take = (next: InstructionsView) => {
    setView(next);
    setGoal(next.goal);
    setInstructions(next.instructions);
  };
  useEffect(() => {
    props.api.instructions().then(take, (e: unknown) => toast.error("Could not load the instructions", { description: message(e) }));
  }, [props.api]);
  if (!view) return <Loading />;
  const dirty = goal.trim() !== view.goal || instructions.trim() !== view.instructions;
  return (
    <form
      id="project-instructions"
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => props.api.saveInstructions({ goal, instructions }, { goal: view.goal, instructions: view.instructions }), "Saved to the project's code").then((next) => next && take(next));
      }}
    >
      <Group title="Goal" note="What this project is for and who uses it. Saved as GOAL.md in the project's code.">
        <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Project goal" placeholder="For example: A shared shopping list for families. Anyone in the family can add, check off and reorder items from their phone." className="max-h-[40vh] min-h-24 overflow-y-auto text-sm" />
      </Group>
      <Group title="Instructions" note="How agents build this project: stack, style and rules. Saved as AGENTS.md in the project's code. Where they differ from the instructions for every project, these win.">
        <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} aria-label="Project instructions" placeholder={"For example:\nThe app is mobile first.\nUse the brand color #0f766e for buttons and links."} className="max-h-[50vh] min-h-36 overflow-y-auto font-mono text-xs leading-relaxed md:text-xs" />
      </Group>
      <SaveRow busy={busy} dirty={dirty} />
      <Group
        title="Instructions for every project"
        note={view.shared ? "Every agent here also follows these." : "None yet. Instructions you set there apply to every project."}
        action={
          <Button type="button" size="sm" variant="outline" onClick={props.onEditShared}>
            Edit for every project
          </Button>
        }
      >
        {view.shared ? <pre className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground" data-shared-instructions>{view.shared}</pre> : null}
      </Group>
    </form>
  );
}

const GROUPS: readonly { readonly kind: MemoryEntry["kind"]; readonly title: string; readonly note: string }[] = [
  { kind: "note", title: "Notes", note: "Things you asked Chef to remember." },
  { kind: "lesson", title: "Lessons", note: "Written when a merge broke main and was undone, so the next try avoids the same mistake." },
  { kind: "feature", title: "Features", note: "A record of each merged feature and the sessions that built it. Chef adds to it, and rewrites its top part, each time that feature merges." },
];

function MemoryRow(props: { readonly entry: MemoryEntry; readonly api: ProjectApi; readonly onSaved: (view: MemoryView) => void }) {
  const { entry } = props;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(entry.text);
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useBusy();
  return (
    <li className="py-1" data-memory={entry.path}>
      <button type="button" className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-muted/60" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
        {entry.feature ? <ToneBadge tone="idle">{entry.feature}</ToneBadge> : null}
        <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:block">{entry.path}</span>
      </button>
      {open ? (
        <form
          className="grid gap-2 pt-1 pb-2 pl-6"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => props.api.editMemory(entry.path, text, entry.text), "Saved").then((view) => view && props.onSaved(view));
          }}
        >
          <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={`Text of ${entry.title}`} className="max-h-[50vh] min-h-32 overflow-y-auto font-mono text-xs leading-relaxed md:text-xs" />
          <SaveRow busy={busy} dirty={text.trim() !== entry.text && text.trim().length > 0}>
            {confirming ? (
              <>
                <span className="text-xs text-muted-foreground">Agents stop recalling it.</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
                <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void run(() => props.api.editMemory(entry.path, null, entry.text), "Removed").then((view) => view && props.onSaved(view))}>
                  Remove
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                <Trash2 />
                Remove
              </Button>
            )}
          </SaveRow>
        </form>
      ) : null}
    </li>
  );
}

function AddNote(props: { readonly api: ProjectApi; readonly onSaved: (view: MemoryView) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const { busy, run } = useBusy();
  return (
    <form
      id="memory-add"
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => props.api.addNote(title, text), "Added to the project memory").then((view) => {
          if (!view) return;
          props.onSaved(view);
          setTitle("");
          setText("");
        });
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Note title" placeholder="Title, like Prices are in euros" required />
      <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Note text" placeholder="What agents should remember" className="min-h-20 text-sm" required />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy || !title.trim() || !text.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}

export function MemoryForm(props: { readonly api: ProjectApi }) {
  const [view, setView] = useState<MemoryView | null>(null);
  useEffect(() => {
    props.api.memory().then(setView, (e: unknown) => toast.error("Could not load the memory", { description: message(e) }));
  }, [props.api]);
  if (!view) return <Loading />;
  return (
    <>
      <Group title="Add a note" note="Agents recall the notes that fit each task.">
        <AddNote api={props.api} onSaved={setView} />
      </Group>
      {GROUPS.map((group) => {
        const entries = view.entries.filter((e) => e.kind === group.kind);
        return (
          <Group key={group.kind} title={`${group.title} (${entries.length})`} note={group.note}>
            {entries.length ? (
              <ul className="grid divide-y" data-memory-group={group.kind}>
                {entries.map((entry) => (
                  <MemoryRow key={`${entry.path}:${entry.text.length}`} entry={entry} api={props.api} onSaved={setView} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing here yet.</p>
            )}
          </Group>
        );
      })}
      <Group title={`Rules (${view.rules.length})`} note="Written when agents keep making the same fix in different features. Every later change is checked against them. Ask Chef in the chat to change or drop one.">
        {view.rules.length ? (
          <ul className="grid divide-y" data-memory-group="rule">
            {view.rules.map((rule) => (
              <li key={rule.id} className="grid gap-0.5 px-1 py-2" data-rule={rule.id}>
                <span className="text-sm">{rule.message}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {rule.id} · {rule.files}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing here yet.</p>
        )}
      </Group>
    </>
  );
}
