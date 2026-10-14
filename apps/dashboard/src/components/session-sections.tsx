import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { ChevronDown, ExternalLink, FileCode2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status";
import { isActive } from "@/lib/events";
import { ago, duration, previewHost, short, tokens } from "@/lib/format";
import type { FeatureNode, SessionNode } from "@/lib/model";
import { entryRoute, isPage, pagesFor, routesIn, type Route } from "@/lib/routes";
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

function PreviewTab({ url, link, commitId, routes, featureId, live }: { readonly url: string | null; readonly link: string | null; readonly commitId: string; readonly routes: readonly Route[]; readonly featureId: string | null; readonly live: boolean }) {
  const [nonce, setNonce] = useState(0);
  const [chosen, setPath] = useState<string | null>(null);
  const pages = pagesFor(routes, featureId);
  const path = chosen ?? pages[0]?.path ?? "/";
  if (!url) return <Empty>The preview appears after chef's first step.</Empty>;
  const base = link ?? url;
  const href = path === "/" ? base : link ? `${link}?path=${encodeURIComponent(path)}` : `${url.replace(/\/$/, "")}${path}`;
  const others = routes.filter((r) => !isPage(r) && r.path !== "/");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex h-9 items-center gap-2 rounded-xl border px-3">
        <StatusDot tone="ok" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {previewHost(url)}
          {path === "/" ? "" : path}
        </span>
        <Button variant="ghost" size="icon-xs" onClick={() => setNonce((n) => n + 1)} aria-label="Reload preview">
          <RefreshCw />
        </Button>
        <Button variant="ghost" size="icon-xs" asChild>
          <a href={href} target="_blank" rel="noreferrer" aria-label={live ? "Open the live app in a new tab" : "Open the preview in a new tab"}>
            <ExternalLink />
          </a>
        </Button>
      </div>
      {pages.length || others.length ? (
        <div className="flex flex-wrap items-center gap-1" data-routes>
          <span className="mr-1 text-xs text-muted-foreground">Pages</span>
          {["/", ...pages.map((r) => r.path)].map((p) => (
            <button key={p} type="button" onClick={() => setPath(p)} className={cn("h-6 rounded-md border px-1.5 font-mono text-[11px] hover:bg-muted", p === path && "border-foreground/40 bg-muted")}>
              {p}
            </button>
          ))}
          {others.map((r) => (
            <span key={`${r.method} ${r.path}`} className="h-6 rounded-md border border-dashed px-1.5 font-mono text-[11px] leading-6 text-muted-foreground" title="An API route that the page and the tests call.">
              {r.method} {r.path}
            </span>
          ))}
        </div>
      ) : null}
      <iframe key={`${nonce}-${path}`} src={href} title={live ? "Live app" : "Preview"} className="min-h-[320px] w-full flex-1 rounded-xl border bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
      <p className="text-xs text-muted-foreground">
        {pages.length || live ? "" : "This build has not added a page yet, so you see the app's home. "}
        {live ? `This is the live app, at ${short(commitId)}. Everything chef merges shows up here.` : `This preview updates after every step chef takes. Built from ${short(commitId)}. It sleeps when nobody opens it for a while and wakes up on the next visit.`}
      </p>
    </div>
  );
}

function FileDiff({ path, before, after }: { readonly path: string; readonly before: string | null; readonly after: string | null }) {
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

export function ChangesTab({ node }: { readonly node: SessionNode }) {
  const { api } = useWorkspace();
  const head = node.live?.commits.at(-1)?.id ?? node.record?.head ?? "";
  const changes = useFetch(() => api.changes(node.id), `${node.id}:${head}:${node.state}`, node.id);
  if (changes.loading && !changes.data) return <Skeleton className="h-40" />;
  if (changes.error) return <Empty>{changes.error}</Empty>;
  const files = changes.data?.files ?? [];
  if (!files.length) return <Empty>No code has changed yet.</Empty>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {files.length} {files.length === 1 ? "file" : "files"} changed compared with the live app.
      </p>
      <div className="overflow-hidden rounded-xl border">
        {files.map((f) => (
          <FileDiff key={f.path} path={f.path} before={f.before} after={f.after} />
        ))}
      </div>
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
  const { api, data, selection } = useWorkspace();
  const detail = useFetch(() => api.session(node.id), `${node.id}:${node.state}:${node.record?.updatedAt ?? 0}`, node.id);
  const turns = useFetch(() => api.turns(node.id), `${node.id}:${node.live?.commits.length ?? node.record?.commits.length ?? 0}`, node.id);
  const sandbox = useFetch(() => api.sandbox(node.id), `${node.id}:${node.state}`, node.id);
  const record = detail.data?.record ?? node.record;
  const budget = detail.data?.budget;
  const usage = record?.machine.usage;
  const elapsed = usage && record ? (isActive(record.machine.state) ? Date.now() : record.updatedAt) - usage.startedAt : 0;
  const running = sandbox.data?.running ?? false;
  const lanes = node.live?.lanes.length ? node.live.lanes.map((l) => ({ role: l.role, branch: l.branch })) : (record?.lanes ?? []).map((l) => ({ role: l.role, branch: l.branch }));
  return (
    <div className="flex flex-col gap-6">
      <Section title="Where the code lives">
        <Facts
          rows={[
            ["Repository", <span className="font-mono text-xs">{record?.forkDeleted ? (record.machine.state === "dropped" ? `archive/${record.id} (fork removed)` : "main (fork removed after merge)") : (record?.fork ?? node.live?.fork ?? "not created")}</span>],
            [
              "Live app",
              data.spec?.live?.url ? (
                <a href={data.spec.live.url} target="_blank" rel="noreferrer" className="font-mono text-xs underline-offset-2 hover:underline">{`${new URL(data.spec.live.url).host} · main ${short(data.spec.commitId) || "none"}`}</a>
              ) : (
                <span className="font-mono text-xs">{`${selection.project} · main ${short(data.spec?.commitId) || "none"}`}</span>
              ),
            ],
            ["Build", <span className="font-mono text-xs">{node.id}</span>],
            ...(lanes.length
              ? [
                  [
                    "Role branches",
                    <span className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs" data-lanes>
                      {lanes.map((l) => (
                        <span key={l.role} data-lane={l.role}>
                          {l.branch}
                        </span>
                      ))}
                    </span>,
                  ] as const,
                ]
              : []),
          ]}
        />
      </Section>
      <Section title="Steps saved as commits">
        {turns.loading && !turns.data ? <Skeleton className="h-16" /> : null}
        {turns.data?.length === 0 ? <p className="text-sm text-muted-foreground">No commits yet.</p> : null}
        {turns.error ? <p className="text-sm text-muted-foreground">Could not load the commits: {turns.error}</p> : null}
        <ul className="flex flex-col gap-1.5">
          {(turns.data ?? []).map((t) => (
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
      </Section>
      <Section title="Sandbox">
        <Facts
          rows={[
            [
              "Container",
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone={running ? "run" : "idle"} />
                {sandbox.loading && !sandbox.data ? "Checking" : sandbox.error ? "Unknown" : running ? "Running" : "Stopped"}
              </span>,
            ],
            ...(lanes.length ? [["Per role", `${lanes.length} containers, one for each role's branch`] as const] : []),
            ["Internet", "Off, except allowed hosts"],
            ...(sandbox.data?.exit ? [["Last exit", sandbox.data.exit] as const] : []),
          ]}
        />
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
          <Empty>Lint, types, tests and the live preview are checked before anything goes live.</Empty>
        )}
      </Section>
    </div>
  );
}

export function SessionPreview({ feature, node }: { readonly feature: FeatureNode; readonly node: SessionNode | null }) {
  const { api, data } = useWorkspace();
  const app = data.spec?.live;
  const live = node?.state === "merged" && app?.url ? { url: app.url, link: null, commitId: app.commitId } : null;
  const preview = live ?? node?.live?.preview ?? node?.record?.preview ?? feature.preview ?? null;
  const head = node?.live?.commits.at(-1)?.id ?? node?.record?.head ?? "";
  const changes = useFetch(node ? () => api.changes(node.id) : null, `${node?.id ?? ""}:${head}`, node?.id ?? "");
  const found = routesIn(changes.data?.files ?? []);
  const entry = entryRoute(feature.spec?.entrypoint);
  const routes = entry && !found.some((r) => r.method === entry.method && r.path === entry.path) ? [entry, ...found] : found;
  return <PreviewTab key={preview?.url ?? ""} url={preview?.url ?? null} link={preview?.link ?? null} commitId={preview?.commitId ?? ""} routes={routes} featureId={feature.id} live={live !== null} />;
}

export function LiveApp() {
  const { data, selection } = useWorkspace();
  const live = data.spec?.live ?? null;
  const routes = (data.spec?.features ?? []).map((f) => entryRoute(f.entrypoint)).filter((r): r is Route => r !== null);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-view="live">
      <div className="flex items-center gap-2">
        <h2 className="truncate text-sm font-medium">{selection.project}</h2>
        <span className="font-mono text-xs text-muted-foreground">main {short(live?.commitId ?? data.spec?.commitId) || ""}</span>
      </div>
      {live?.url ? (
        <PreviewTab key={live.url} url={live.url} link={null} commitId={live.commitId} routes={routes} featureId={null} live />
      ) : (
        <Empty>{live?.status === "failed" ? `The live app could not be updated: ${live.error ?? "unknown error"}` : live?.status === "deploying" ? "chef is putting main on the live address." : "The live app appears here once main is deployed."}</Empty>
      )}
    </div>
  );
}
