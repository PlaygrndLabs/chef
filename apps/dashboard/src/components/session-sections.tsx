import { useEffect, useMemo, useRef, useState } from "react";
import { diffLines } from "diff";
import { ArrowLeft, ArrowRight, ChevronDown, ExternalLink, FileCode2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status";
import { AppFrame, loadTone, useAppLoad } from "@/components/app-frame";
import { CloudflareList, CloudflareSections } from "@/components/cloudflare-resources";
import { isActive } from "@/lib/events";
import { ago, appHost, duration, short, tokens } from "@/lib/format";
import type { SessionTurn } from "@chef/core";
import { laneSummary } from "@/lib/agents";
import type { FeatureNode, SessionNode } from "@/lib/model";
import { addressPath, appLink, entryPage, frameReport, MAIN_APP, pageChips, step, visit, type AppPage, type Trail } from "@/lib/app-view";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="kicker">{title}</h3>
      {children}
    </section>
  );
}

export function Empty({ children }: { readonly children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function Facts({ rows }: { readonly rows: readonly (readonly [string, React.ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AppTab({ link, url, start, title, note, missing }: { readonly link: string; readonly url: string | null; readonly start: string; readonly title: string; readonly note: string; readonly missing: string }) {
  const [trail, setTrail] = useState<Trail>({ entries: [start], index: 0 });
  const [load, setLoad] = useState({ path: start, count: 0 });
  const [pages, setPages] = useState<readonly AppPage[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const app = useAppLoad({ link, path: load.path, count: load.count, missing });
  const { loaded } = app;
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const report = frameReport(event.data);
      if (!report) return;
      loaded();
      setPages(report.pages);
      setTrail((current) => visit(current, report.path));
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);
  const path = trail.entries[trail.index] ?? "/";
  const target = (to: string) => (to === "/" ? link : `${link}?path=${encodeURIComponent(to)}`);
  const host = app.appUrl ?? url;
  const open = (to: string) => setLoad((current) => ({ path: to, count: current.count + 1 }));
  const go = (to: string) => {
    setDraft(null);
    setTrail((current) => visit(current, to));
    open(to);
  };
  const move = (delta: number) => {
    const next = step(trail, delta);
    setTrail(next);
    open(next.entries[next.index] ?? "/");
  };
  const shown = path.split(/[?#]/)[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <form
        className="flex h-9 items-center gap-1 rounded-xl border px-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          go(addressPath(draft ?? path));
        }}
      >
        <Button type="button" variant="ghost" size="icon-xs" disabled={trail.index === 0} onClick={() => move(-1)} aria-label="Back">
          <ArrowLeft />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" disabled={trail.index >= trail.entries.length - 1} onClick={() => move(1)} aria-label="Forward">
          <ArrowRight />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" onClick={() => open(path)} aria-label="Reload the app">
          <RefreshCw />
        </Button>
        <span className="flex min-w-0 flex-1 items-center">
          <StatusDot tone={loadTone(app.load)} />
          {host ? <span className="ml-2 max-w-[45%] shrink-0 truncate font-mono text-xs text-muted-foreground">{appHost(host)}</span> : null}
          <input
            value={draft ?? path}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setDraft(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(null);
            }}
            spellCheck={false}
            aria-label="Page address"
            className="h-7 min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
          />
        </span>
        <Button variant="ghost" size="icon-xs" asChild>
          <a href={target(path)} target="_blank" rel="noreferrer" aria-label="Open the app in a new tab">
            <ExternalLink />
          </a>
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1" data-pages>
        <span className="mr-1 text-xs text-muted-foreground">Pages</span>
        {pageChips(pages, start).map((p) => (
          <button key={p.path} type="button" title={p.title || undefined} onClick={() => go(p.path)} className={cn("h-6 rounded-md border px-1.5 font-mono text-[11px] hover:bg-muted", p.path === shown && "border-foreground/40 bg-muted")}>
            {p.path}
          </button>
        ))}
      </div>
      <AppFrame
        ref={frame}
        key={load.count}
        src={app.ready ? target(load.path) : null}
        title={title}
        load={app.load}
        path={load.path}
        onLoad={loaded}
        onRetry={() => {
          app.retryNext();
          open(path);
        }}
      />
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export function FileDiff({ path, before, after }: { readonly path: string; readonly before: string | null; readonly after: string | null }) {
  const [open, setOpen] = useState(false);
  const parts = useMemo(() => diffLines(before ?? "", after ?? ""), [before, after]);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60">
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
        {before === null ? <span className="text-xs text-muted-foreground">new</span> : after === null ? <span className="text-xs text-muted-foreground">deleted</span> : null}
        <span className="font-mono text-xs text-ok">+{added}</span>
        <span className="font-mono text-xs text-bad">−{removed}</span>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-96 overflow-auto bg-muted/50 px-3 py-2 font-mono text-[11px] leading-relaxed">
          {parts.map((part, i) => (
            <span key={i} className={cn("block whitespace-pre-wrap", part.added && "bg-ok/10 text-ok", part.removed && "bg-bad/10 text-bad", !part.added && !part.removed && "text-muted-foreground")}>
              {part.value
                .replace(/\n$/, "")
                .split("\n")
                .map((line) => `${part.added ? "+" : part.removed ? "−" : " "} ${line}`)
                .join("\n")}
            </span>
          ))}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CommitList({ turns }: { readonly turns: readonly SessionTurn[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {turns.map((t) => (
        <li key={t.commitId}>
          <Collapsible className="rounded-lg border">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60">
              <span className="font-mono text-xs text-muted-foreground">{short(t.commitId)}</span>
              <span className="min-w-0 flex-1 truncate">{t.message.split("\n")[0]}</span>
              <span className="text-xs text-muted-foreground">{t.timestamp ? ago(t.timestamp) : ""}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-3 py-2 text-xs">
              {t.note ? (
                <>
                  <div className="mb-1 text-muted-foreground">
                    {t.note.role} · {t.note.model} · {t.note.paths.length} files
                  </div>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{t.note.prompt}</pre>
                </>
              ) : (
                <span className="text-muted-foreground">No prompt saved with this commit.</span>
              )}
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
    </ul>
  );
}

export function RoleWork({ node, role }: { readonly node: SessionNode; readonly role: string }) {
  const { api } = useWorkspace();
  const head = node.live?.commits.at(-1)?.id ?? node.record?.head ?? "";
  const turns = useFetch(() => api.turns(node.id), `${node.id}:${head}`, node.id);
  const changes = useFetch(() => api.changes(node.id), `${node.id}:${head}:${node.state}`, node.id);
  const lane = laneSummary(node, role);
  const cloudflare = useFetch(() => api.cloudflare(node.id), `${node.id}:${node.state}:${head}`, node.id);
  const mineOnCloudflare = (cloudflare.data?.resources ?? []).filter((r) => r.roles.includes(role));
  const mine = (turns.data ?? []).filter((t) => t.note?.role === role);
  const paths = new Set([...(lane?.owns ?? []), ...mine.flatMap((t) => t.note?.paths ?? [])]);
  const files = (changes.data?.files ?? []).filter((f) => paths.has(f.path));
  return (
    <div className="flex flex-col gap-6" data-role-work={role}>
      {lane ? (
        <Facts
          rows={[
            ["Branch", <span className="font-mono text-xs" data-role-branch>{lane.branch}</span>],
            ["Status", <span data-role-status>{lane.status}</span>],
            ...(lane.steps ? [["Steps", `${lane.steps.done} of ${lane.steps.of} done`] as const] : []),
            ["Commits", `${lane.commits}`],
          ]}
        />
      ) : null}
      <Section title="What it uses on Cloudflare">
        {cloudflare.loading && !cloudflare.data ? <Skeleton className="h-16" /> : null}
        {cloudflare.error ? <p className="text-sm text-muted-foreground">Could not read the Cloudflare details: {cloudflare.error}</p> : null}
        {cloudflare.data && !mineOnCloudflare.length ? <p className="text-sm text-muted-foreground">This role uses nothing on Cloudflare in this build.</p> : null}
        {mineOnCloudflare.length ? <CloudflareList resources={mineOnCloudflare} showRoles={false} /> : null}
      </Section>
      <Section title="Its commits">
        {turns.loading && !turns.data ? <Skeleton className="h-16" /> : null}
        {turns.error ? <p className="text-sm text-muted-foreground">Could not load the commits: {turns.error}</p> : null}
        {turns.data && !mine.length ? <p className="text-sm text-muted-foreground">No commits from this role yet.</p> : null}
        <CommitList turns={mine} />
      </Section>
      <Section title="Files it changed">
        {changes.loading && !changes.data ? <Skeleton className="h-16" /> : null}
        {changes.data && !files.length ? <p className="text-sm text-muted-foreground">{lane ? "None of its files differ from main yet." : "This role changed no app files in this build."}</p> : null}
        {files.length ? (
          <div className="overflow-hidden border" data-role-files>
            {files.map((f) => (
              <FileDiff key={f.path} path={f.path} before={f.before} after={f.after} />
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function Meter({ label, value, max, text }: { readonly label: string; readonly value: number; readonly max: number; readonly text: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span>{text}</span>
      </div>
      <Progress value={pct} className={cn("h-1.5", pct >= 100 && "[&>*]:bg-bad")} aria-label={`${label} ${pct}%`} />
    </div>
  );
}

export function DetailsTab({ node }: { readonly node: SessionNode }) {
  const { api } = useWorkspace();
  const detail = useFetch(() => api.session(node.id), `${node.id}:${node.state}:${node.record?.updatedAt ?? 0}`, node.id);
  const turns = useFetch(() => api.turns(node.id), `${node.id}:${node.live?.commits.length ?? node.record?.commits.length ?? 0}`, node.id);
  const cloudflare = useFetch(() => api.cloudflare(node.id), `${node.id}:${node.state}:${node.record?.updatedAt ?? 0}`, node.id);
  const record = detail.data?.record ?? node.record;
  const budget = detail.data?.budget;
  const usage = record?.machine.usage;
  const elapsed = usage && record ? (isActive(record.machine.state) ? Date.now() : record.updatedAt) - usage.startedAt : 0;
  return (
    <div className="flex flex-col gap-6">
      <Section title="On Cloudflare">
        <CloudflareSections view={cloudflare.data} loading={cloudflare.loading} error={cloudflare.error} />
      </Section>
      <Section title="Steps saved as commits">
        {turns.loading && !turns.data ? <Skeleton className="h-16" /> : null}
        {turns.data?.length === 0 ? <p className="text-sm text-muted-foreground">No commits yet.</p> : null}
        {turns.error ? <p className="text-sm text-muted-foreground">Could not load the commits: {turns.error}</p> : null}
        <CommitList turns={turns.data ?? []} />
      </Section>
      {usage && budget ? (
        <Section title="Budget">
          <Meter label="Tries" value={usage.attempts} max={budget.maxAttempts} text={`${usage.attempts} of ${budget.maxAttempts}`} />
          <Meter label="Tokens" value={usage.tokens} max={budget.maxTokens} text={`${tokens(usage.tokens)} of ${tokens(budget.maxTokens)}`} />
          <Meter label="Time" value={elapsed} max={budget.maxMillis} text={`${duration(elapsed)} of ${duration(budget.maxMillis)}`} />
        </Section>
      ) : null}
      {node.live?.recalled.length ? (
        <Section title="Lessons it remembered">
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {node.live.recalled.map((p) => (
              <li key={p} className="truncate">
                {p}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

export function ChecksTab({ node }: { readonly node: SessionNode }) {
  const verdict = node.live?.verdict ?? node.record?.verdict ?? null;
  const gate = node.live?.gate ?? null;
  return (
    <div className="flex flex-col gap-6">
      <Section title="Review">
        {verdict ? (
          <div className={cn("flex flex-col gap-1.5 rounded-xl border p-3 text-sm", verdict.approve ? "border-ok/30" : "border-bad/30")}>
            <span className={cn("font-medium", verdict.approve ? "text-ok" : "text-bad")}>{verdict.approve ? "Approved" : "Asked for changes"}</span>
            {verdict.reasons.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
                {verdict.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <Empty>A second model reads the change after the code is written.</Empty>
        )}
      </Section>
      <Section title="Final checks">
        {gate ? (
          <div className="overflow-hidden rounded-xl border">
            {gate.checks.map((c) => (
              <Collapsible key={c.name} className="border-b last:border-b-0" data-check={c.name} data-ok={c.ok}>
                <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60">
                  <StatusDot tone={c.ok ? "ok" : "bad"} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className={cn("text-xs", c.ok ? "text-muted-foreground" : "font-medium text-bad")}>{c.ok ? "passed" : "failed"}</span>
                  {c.log ? <ChevronDown className="size-3.5 text-muted-foreground" /> : null}
                </CollapsibleTrigger>
                {c.log ? (
                  <CollapsibleContent>
                    <pre className="max-h-72 overflow-auto bg-muted/50 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap">{c.log}</pre>
                  </CollapsibleContent>
                ) : null}
              </Collapsible>
            ))}
          </div>
        ) : (
          <Empty>Lint, types, tests and the running app are checked before anything is merged into main.</Empty>
        )}
      </Section>
    </div>
  );
}

const SLEEPS = "It sleeps when nobody opens it for a while and wakes up on the next visit.";

export function SessionApp({ feature, node }: { readonly feature: FeatureNode; readonly node: SessionNode | null }) {
  const { selection } = useWorkspace();
  const app = node ? (node.live?.app ?? node.record?.app ?? null) : feature.app;
  const id = node?.id ?? feature.app?.sessionId ?? null;
  const merged = node?.state === "merged";
  const committed = Boolean(node?.record?.head ?? node?.live?.commits.length);
  if (!id || (!app && !merged && !committed)) return <Empty>This build's app starts after Chef's first commit.</Empty>;
  const commit = app ? ` It runs ${short(app.commitId)}.` : "";
  const note = merged ? `This build is merged into main, so this is main's app, the release candidate, with this work together with everything else Chef merged. ${SLEEPS}` : `This is the app of this build's branch, with its whole stack running in the build's own sandbox. It starts again after every step Chef takes.${commit} ${SLEEPS}`;
  return <AppTab key={merged ? `${id}:main` : `${id}:${app?.status ?? ""}:${app?.commitId ?? ""}`} link={appLink(selection.project, id)} url={merged ? null : (app?.url ?? null)} start={entryPage(feature.spec?.entrypoint) ?? "/"} title="App" note={note} missing="This build has no commit yet, so it has no app to open." />;
}

export function MainApp() {
  const { data, selection } = useWorkspace();
  const app = data.spec?.mainApp ?? null;
  if (!data.spec?.commitId) return <Empty>Main has no commit yet. Its app starts after the first one.</Empty>;
  const note = `This is main's app, the release candidate, with its whole stack running in main's own sandbox${app ? ` at ${short(app.commitId)}` : ""}. Everything Chef merges shows up here. Your own production takes main from your repository. ${SLEEPS}`;
  return <AppTab key={`${MAIN_APP}:${app?.status ?? ""}:${app?.commitId ?? ""}`} link={appLink(selection.project, MAIN_APP)} url={app?.url ?? null} start="/" title="App of main" note={note} missing="Main has no commit yet, so it has no app to open." />;
}
