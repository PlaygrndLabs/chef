import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { SessionChanges, SessionRecord, SessionTurn } from "@chef/core";
import { Wordmark } from "@/components/logo";
import { PreviewFrame, usePreviewLoad, type StateFetch } from "@/components/preview-frame";
import { CommitList, Empty, FileDiff } from "@/components/session-sections";
import { StatusPill } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { linkApi, type SharedApi, type SharedTarget } from "@/lib/api";
import { host } from "@/host";
import { previewHost } from "@/lib/format";
import { statusOf } from "@/lib/model";
import { entryPage, enterAt } from "@/lib/preview";

interface Shared {
  readonly target: SharedTarget;
  readonly record: SessionRecord | null;
}

function SharedPreview({ api, project, previewKey, start }: { readonly api: SharedApi; readonly project: string; readonly previewKey: string; readonly start: string }) {
  const [count, setCount] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const ask = useCallback<StateFetch>((link, retry) => api.previewState(link, retry), [api]);
  const preview = usePreviewLoad({ link: `/preview/${project}/${previewKey}`, url: "", path: start, count, fetch: ask });
  const src = preview.enter ? enterAt(preview.enter, start) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex h-9 items-center gap-2 border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{preview.appUrl ? `${previewHost(preview.appUrl)}${start}` : "Opening the preview"}</span>
        {src ? (
          <Button variant="ghost" size="icon-xs" asChild>
            <a href={src} target="_blank" rel="noreferrer" aria-label="Open the preview in a new tab">
              <ExternalLink />
            </a>
          </Button>
        ) : null}
      </div>
      <PreviewFrame
        ref={frame}
        key={count}
        src={src}
        title="Preview"
        load={preview.load}
        preview
        path={start}
        onLoad={preview.loaded}
        onRetry={() => {
          preview.retryNext();
          setCount((c) => c + 1);
        }}
      />
    </div>
  );
}

function SharedChanges({ api, project, id }: { readonly api: SharedApi; readonly project: string; readonly id: string }) {
  const [changes, setChanges] = useState<SessionChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api.changes(project, id).then(setChanges, (e: unknown) => setError(e instanceof Error ? e.message : String(e))), [api, project, id]);
  if (error) return <Empty>{error}</Empty>;
  if (!changes) return <Empty>Loading the changes.</Empty>;
  if (!changes.files.length) return <Empty>No code has changed yet.</Empty>;
  return (
    <div className="overflow-hidden rounded-xl border">
      {changes.files.map((f) => (
        <FileDiff key={f.path} path={f.path} before={f.before} after={f.after} />
      ))}
    </div>
  );
}

function SharedCommits({ api, project, id }: { readonly api: SharedApi; readonly project: string; readonly id: string }) {
  const [turns, setTurns] = useState<readonly SessionTurn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api.turns(project, id).then(setTurns, (e: unknown) => setError(e instanceof Error ? e.message : String(e))), [api, project, id]);
  if (error) return <Empty>{error}</Empty>;
  if (!turns) return <Empty>Loading the commits.</Empty>;
  if (!turns.length) return <Empty>No commits yet.</Empty>;
  return <CommitList turns={turns} />;
}

function SharedView({ api }: { readonly api: SharedApi }) {
  const [shared, setShared] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .target()
      .then(async (target) => setShared({ target, record: target.kind === "session" ? (await api.session(target.project, target.id)).record : null }))
      .catch((e: unknown) => setError(e instanceof Error && /401|403|not valid/.test(e.message) ? "This link has ended or was never valid." : e instanceof Error ? e.message : String(e)));
  }, [api]);
  if (error) return <SharedError message={error} />;
  if (!shared) return <div className="h-dvh" data-view="shared-loading" />;
  const { target, record } = shared;
  const previewKey = record ? record.previewKey : target.id;
  const start = entryPage(record?.plan.feature.entrypoint) ?? "/";
  return (
    <div className="flex h-dvh flex-col" data-view="shared" data-shared={target.kind}>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Wordmark />
        <span className="h-4 w-px bg-border" />
        <h1 className="min-w-0 truncate text-base font-medium">{record?.plan.feature.title ?? target.name}</h1>
        {record ? <StatusPill status={statusOf(record.machine.state)} /> : null}
        <span className="flex-1" />
        <span className="hidden text-xs text-muted-foreground sm:inline">Shared with you to look at</span>
      </header>
      {record ? (
        <Tabs defaultValue="preview" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex shrink-0 items-center border-b px-3 py-2">
            <TabsList className="h-8">
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="commits">Commits</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col p-4">
            <SharedPreview api={api} project={target.project} previewKey={previewKey} start={start} />
          </TabsContent>
          <TabsContent value="changes" className="min-h-0 flex-1 overflow-y-auto p-4">
            <SharedChanges api={api} project={target.project} id={target.id} />
          </TabsContent>
          <TabsContent value="commits" className="min-h-0 flex-1 overflow-y-auto p-4">
            <SharedCommits api={api} project={target.project} id={target.id} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <SharedPreview api={api} project={target.project} previewKey={previewKey} start={start} />
        </div>
      )}
    </div>
  );
}

function SharedError({ message }: { readonly message: string }) {
  return (
    <div className="grid h-dvh place-items-center p-6 text-center" data-view="shared-error">
      <div className="grid justify-items-center gap-3">
        <Wordmark />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

export function SharedPage() {
  const api = useMemo(() => (host.sharedApi ? host.sharedApi() : linkApi(location.hash.replace(/^#/, ""))), []);
  useEffect(() => document.getElementById("splash")?.remove(), []);
  if (!api) return <SharedError message="This link is missing its key. Ask for the whole link again." />;
  return <SharedView api={api} />;
}
