import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { ArrowLeft, ExternalLink, GitBranch, GitCommitHorizontal, GitMerge } from "lucide-react";
import type { CommitChanges, HistoryEntry } from "@chef/core";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/session-sections";
import { roleLabel, useAgents } from "@/lib/agents";
import { ago, short } from "@/lib/format";
import type { SessionNode } from "@/lib/model";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const PAGE = 50;
const CONTEXT = 3;

type FileChange = CommitChanges["files"][number];
type Mark = "live" | "pulled" | "pushed";

const MARK_LABEL: Readonly<Record<Mark, string>> = { live: "Live", pulled: "From GitHub", pushed: "On GitHub" };

interface Line {
  readonly kind: "same" | "add" | "del";
  readonly old: number | null;
  readonly now: number | null;
  readonly text: string;
}

type Row = Line | { readonly kind: "gap"; readonly hidden: number };

function linesOf(file: FileChange): Line[] {
  const out: Line[] = [];
  let old = 1;
  let now = 1;
  for (const part of diffLines(file.before ?? "", file.after ?? "")) {
    for (const text of part.value.replace(/\n$/, "").split("\n")) {
      if (part.added) out.push({ kind: "add", old: null, now: now++, text });
      else if (part.removed) out.push({ kind: "del", old: old++, now: null, text });
      else out.push({ kind: "same", old: old++, now: now++, text });
    }
  }
  return out;
}

function hunks(lines: readonly Line[]): Row[] {
  const near = lines.map(() => false);
  lines.forEach((line, i) => {
    if (line.kind === "same") return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) near[j] = true;
  });
  const rows: Row[] = [];
  let hidden = 0;
  lines.forEach((line, i) => {
    if (near[i]) {
      if (hidden) rows.push({ kind: "gap", hidden });
      hidden = 0;
      rows.push(line);
    } else hidden++;
  });
  if (hidden) rows.push({ kind: "gap", hidden });
  return rows;
}

function counts(file: FileChange): { readonly added: number; readonly removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(file.before ?? "", file.after ?? "")) {
    if (part.added) added += part.count ?? 0;
    if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

function fileState(file: FileChange): { readonly letter: string; readonly title: string; readonly tone: string } {
  if (file.before === null) return { letter: "A", title: "Added", tone: "text-ok" };
  if (file.after === null) return { letter: "D", title: "Deleted", tone: "text-bad" };
  return { letter: "M", title: "Changed", tone: "text-brand" };
}

function MarkChip({ mark }: { readonly mark: Mark }) {
  return <span className={cn("shrink-0 border px-1 font-mono text-[10px] leading-4 tracking-wider uppercase", mark === "live" ? "border-brand bg-brand text-brand-foreground" : "border-foreground/30 text-muted-foreground")}>{MARK_LABEL[mark]}</span>;
}

function CommitRow({ entry, marks, selected, onSelect }: { readonly entry: HistoryEntry; readonly marks: readonly Mark[]; readonly selected: boolean; readonly onSelect: () => void }) {
  const view = useAgents(useWorkspace().selection.project);
  const who = entry.note ? roleLabel(entry.note.role, view) : entry.author;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-commit={entry.id}
        className={cn("flex w-full flex-col gap-1 px-3 py-2 text-left dash-b hover:bg-muted/60", selected && "bg-muted shadow-[inset_2px_0_0_var(--brand)]")}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {entry.parents.length > 1 ? <GitMerge className="size-3.5 shrink-0 text-muted-foreground" aria-label="Merge" /> : null}
          <span className="min-w-0 flex-1 truncate text-[13px]">{entry.message.split("\n")[0] || "(no message)"}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{short(entry.id)}</span>
          <span className="min-w-0 truncate">{who}</span>
          <span className="ml-auto shrink-0">{ago(entry.timestamp)}</span>
        </span>
        {marks.length ? (
          <span className="flex flex-wrap gap-1">
            {marks.map((m) => (
              <MarkChip key={m} mark={m} />
            ))}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function Diff({ file }: { readonly file: FileChange }) {
  const rows = useMemo(() => hunks(linesOf(file)), [file]);
  if (file.before === file.after) return <p className="p-4 text-sm text-muted-foreground">Only the file's mode changed.</p>;
  return (
    <div className="min-w-max font-mono text-[12px] leading-5" data-diff={file.path}>
      {rows.map((row, i) =>
        row.kind === "gap" ? (
          <div key={i} className="border-y border-dashed bg-muted/40 px-3 text-muted-foreground">
            ⋯ {row.hidden} unchanged {row.hidden === 1 ? "line" : "lines"}
          </div>
        ) : (
          <div key={i} className={cn("flex", row.kind === "add" && "bg-ok/10", row.kind === "del" && "bg-bad/10")}>
            <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">{row.old ?? ""}</span>
            <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">{row.now ?? ""}</span>
            <span className={cn("w-4 shrink-0 select-none", row.kind === "add" && "text-ok", row.kind === "del" && "text-bad")}>{row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}</span>
            <span className={cn("pr-4 whitespace-pre", row.kind === "add" && "text-ok", row.kind === "del" && "text-bad")}>{row.text}</span>
          </div>
        ),
      )}
    </div>
  );
}

function FilesPane({ files, loading }: { readonly files: readonly FileChange[]; readonly loading: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  const file = files.find((f) => f.path === picked) ?? files[0] ?? null;
  const tallies = useMemo(() => new Map(files.map((f) => [f.path, counts(f)])), [files]);
  if (!files.length)
    return loading ? (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    ) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col @5xl:flex-row">
      <ul className="max-h-40 shrink-0 overflow-y-auto dash-b @5xl:max-h-none @5xl:w-64 @5xl:border-r @5xl:border-b-0 @5xl:border-dashed" aria-label="Changed files">
        {files.map((f) => {
          const state = fileState(f);
          const tally = tallies.get(f.path);
          const name = f.path.split("/").at(-1) ?? f.path;
          const dir = f.path.slice(0, f.path.length - name.length);
          return (
            <li key={f.path}>
              <button type="button" onClick={() => setPicked(f.path)} aria-current={f === file ? "true" : undefined} title={`${state.title}: ${f.path}`} data-file={f.path} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60", f === file && "bg-muted")}>
                <span className={cn("w-3 shrink-0 font-mono font-medium", state.tone)}>{state.letter}</span>
                <span className="min-w-0 flex-1 truncate" dir="rtl">
                  <bdi>
                    <span className="text-muted-foreground">{dir}</span>
                    {name}
                  </bdi>
                </span>
                {tally ? (
                  <span className="shrink-0 font-mono text-[11px]">
                    <span className="text-ok">+{tally.added}</span> <span className="text-bad">−{tally.removed}</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {file ? (
          <>
            <div className="flex h-8 shrink-0 items-center gap-2 px-3 dash-b">
              <span className="min-w-0 truncate font-mono text-xs">{file.path}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <Diff key={file.path} file={file} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function BackButton({ onBack }: { readonly onBack: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" className="-ml-2 @xl:hidden" onClick={onBack} aria-label="All commits">
      <ArrowLeft />
    </Button>
  );
}

function CommitDetail({ id, load, onBack }: { readonly id: string; readonly load: (id: string) => Promise<CommitChanges>; readonly onBack: () => void }) {
  const { features, openFeature, selection } = useWorkspace();
  const view = useAgents(selection.project);
  const changes = useFetch(() => load(id), id);
  const files = changes.data?.files ?? [];
  const commit = changes.data?.commit ?? null;
  const feature = commit?.note ? features.find((f) => f.id === commit.note?.feature) : undefined;
  const [subject, ...body] = (commit?.message ?? "").split("\n");
  return (
    <div className="flex h-full min-h-0 flex-col" data-commit-detail={id}>
      <div className="flex shrink-0 flex-col gap-2 px-4 py-3 dash-b">
        <div className="flex items-start gap-2">
          <BackButton onBack={onBack} />
          {commit ? <h2 className="min-w-0 flex-1 text-sm font-medium break-words">{subject || "(no message)"}</h2> : <Skeleton className="h-5 w-2/3" />}
        </div>
        {body.join("\n").trim() ? <pre className="max-h-28 overflow-auto font-sans text-xs whitespace-pre-wrap text-muted-foreground">{body.join("\n").trim()}</pre> : null}
        {commit ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-mono text-foreground">
              <GitCommitHorizontal className="size-3.5" />
              {short(commit.id)}
            </span>
            <span>{commit.note ? `${roleLabel(commit.note.role, view)} · ${commit.note.kind}` : commit.author}</span>
            <span title={new Date(commit.timestamp).toLocaleString()}>{ago(commit.timestamp)}</span>
            {commit.parents.length > 1 ? <span className="font-mono">merge of {commit.parents.map((p) => short(p)).join(" + ")}</span> : commit.parents[0] ? <span className="font-mono">after {short(commit.parents[0])}</span> : <span>first commit</span>}
            <span>
              {files.length} {files.length === 1 ? "file" : "files"}
            </span>
            {feature && feature.id !== selection.feature ? (
              <button type="button" onClick={() => openFeature(feature.id)} className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline" data-commit-feature={feature.id}>
                {feature.title}
                <ExternalLink className="size-3" />
              </button>
            ) : null}
          </div>
        ) : null}
        {commit?.note?.prompt ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What Chef was asked</summary>
            <pre className="mt-1 max-h-40 overflow-auto bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{commit.note.prompt}</pre>
          </details>
        ) : null}
      </div>
      {changes.error ? <p className="p-4 text-sm text-muted-foreground">Could not load this commit: {changes.error}</p> : null}
      {changes.data && !files.length ? <p className="p-4 text-sm text-muted-foreground">This commit changed no files.</p> : null}
      <FilesPane files={files} loading={changes.loading} />
    </div>
  );
}

interface Summary {
  readonly title: string;
  readonly note: string;
  readonly key: string;
  readonly load: () => Promise<readonly FileChange[]>;
}

const SUMMARY = ":all";

function SummaryDetail({ summary, onBack }: { readonly summary: Summary; readonly onBack: () => void }) {
  const files = useFetch(summary.load, summary.key);
  const list = files.data ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col" data-commit-detail={SUMMARY}>
      <div className="flex shrink-0 flex-col gap-1 px-4 py-3 dash-b">
        <div className="flex items-start gap-2">
          <BackButton onBack={onBack} />
          <h2 className="min-w-0 flex-1 text-sm font-medium">{summary.title}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{files.data ? `${list.length} ${list.length === 1 ? "file" : "files"} ${summary.note}` : " "}</p>
      </div>
      {files.error ? <p className="p-4 text-sm text-muted-foreground">Could not load the changes: {files.error}</p> : null}
      {files.data && !list.length ? <p className="p-4 text-sm text-muted-foreground">No code has changed yet.</p> : null}
      <FilesPane files={list} loading={files.loading} />
    </div>
  );
}

interface GitViewProps {
  readonly label: string;
  readonly head: React.ReactNode;
  readonly commits: readonly HistoryEntry[] | null;
  readonly error: string | null;
  readonly empty: string;
  readonly marks?: ReadonlyMap<string, readonly Mark[]>;
  readonly summary?: Summary;
  readonly more?: { readonly onMore: () => void; readonly loading: boolean } | null;
  readonly load: (id: string) => Promise<CommitChanges>;
}

function GitView({ label, head, commits, error, empty, marks, summary, more, load }: GitViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  const list = commits ?? [];
  const selected = picked === SUMMARY && summary ? SUMMARY : picked && list.some((c) => c.id === picked) ? picked : summary ? SUMMARY : (list[0]?.id ?? null);
  const pick = (id: string) => {
    setPicked(id);
    setShowing(true);
  };
  if (error) return <div className="p-4"><Empty>{error}</Empty></div>;
  if (commits && !list.length && !summary) return <div className="p-4"><Empty>{empty}</Empty></div>;
  return (
    <div className="@container flex h-full min-h-0" data-view="history">
      <div className={cn("flex min-h-0 w-full flex-col @xl:w-64 @xl:shrink-0 @xl:border-r @xl:border-dashed @5xl:w-80", showing && "@max-xl:hidden")}>
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 dash-b">{head}</div>
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label={label}>
          {summary ? (
            <li>
              <button type="button" onClick={() => pick(SUMMARY)} aria-current={selected === SUMMARY ? "true" : undefined} data-commit={SUMMARY} className={cn("flex w-full flex-col gap-1 px-3 py-2 text-left dash-b hover:bg-muted/60", selected === SUMMARY && "bg-muted shadow-[inset_2px_0_0_var(--brand)]")}>
                <span className="text-[13px] font-medium">{summary.title}</span>
                <span className="text-xs text-muted-foreground">Everything on this branch {summary.note}</span>
              </button>
            </li>
          ) : null}
          {commits
            ? list.map((c) => <CommitRow key={c.id} entry={c} marks={marks?.get(c.id) ?? []} selected={c.id === selected} onSelect={() => pick(c.id)} />)
            : Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="flex flex-col gap-1.5 px-3 py-2 dash-b">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </li>
              ))}
          {commits && !list.length ? <li className="px-3 py-4 text-xs text-muted-foreground">{empty}</li> : null}
          {more ? (
            <li className="p-3">
              <Button variant="outline" size="sm" className="w-full" disabled={more.loading} onClick={more.onMore}>
                Show older commits
              </Button>
            </li>
          ) : null}
        </ul>
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1", !showing && "@max-xl:hidden")}>
        {selected === SUMMARY && summary ? <SummaryDetail summary={summary} onBack={() => setShowing(false)} /> : selected ? <CommitDetail key={selected} id={selected} load={load} onBack={() => setShowing(false)} /> : null}
      </div>
    </div>
  );
}

export function HistoryView() {
  const { api, data } = useWorkspace();
  const [limit, setLimit] = useState(PAGE);
  const head = data.spec?.commitId ?? "";
  const history = useFetch(() => api.history(limit), `${head}:${limit}`, "history");
  const git = useFetch(() => api.git(), head, "git");
  const marks = useMemo(() => {
    const out = new Map<string, Mark[]>();
    const add = (id: string | null | undefined, mark: Mark) => {
      if (id) out.set(id, [...(out.get(id) ?? []), mark]);
    };
    add(data.spec?.live?.commitId, "live");
    add(git.data?.state?.pulled, "pulled");
    add(git.data?.state?.pushed, "pushed");
    return out;
  }, [data.spec?.live?.commitId, git.data]);
  const link = git.data?.settings ?? null;
  return (
    <GitView
      label="Commits on main"
      head={
        <>
          <span className="kicker">main</span>
          <span className="font-mono text-xs text-muted-foreground">{short(history.data?.head)}</span>
          <span className="flex-1" />
          {link ? (
            <a href={link.url.replace(/\.git$/, "")} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground" title={`Linked to ${link.url}, branch ${link.branch}`}>
              GitHub
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : null}
        </>
      }
      commits={history.data?.commits ?? null}
      error={history.error ? `Could not load the history of main: ${history.error}` : null}
      empty="main has no commits yet."
      marks={marks}
      more={history.data?.more ? { onMore: () => setLimit(limit + PAGE), loading: history.loading } : null}
      load={api.commit}
    />
  );
}

export function BranchView({ node }: { readonly node: SessionNode }) {
  const { api } = useWorkspace();
  const tip = node.live?.commits.at(-1)?.id ?? node.record?.head ?? "";
  const key = `${node.id}:${tip}:${node.state}`;
  const history = useFetch(() => api.sessionHistory(node.id), key, node.id);
  const branch = history.data;
  const merged = node.state === "merged";
  return (
    <GitView
      label="Commits on this branch"
      head={
        <>
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono text-xs" data-branch-name>{branch?.branch ?? " "}</span>
          {branch?.from ? <span className="font-mono text-xs text-muted-foreground" data-branch-from="main">from main {short(branch.from)}</span> : null}
          {branch?.merged ? <span className="font-mono text-xs text-ok" data-branch-into="main">in main {short(branch.merged)}</span> : null}
        </>
      }
      commits={branch?.commits ?? null}
      error={history.error ? `Could not load this branch: ${history.error}` : null}
      empty="No commits on this branch yet."
      summary={{ title: "All changes", note: merged ? "compared with main before it went live" : "compared with the live app", key, load: () => api.changes(node.id).then((c) => c.files) }}
      load={(id) => api.sessionCommit(node.id, id)}
    />
  );
}
