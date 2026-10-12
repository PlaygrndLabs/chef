import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { Box, ChevronDown, ExternalLink, FileCode2, GitBranch, GitFork, Lock, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StateBadge, StatusDot, ToneBadge } from "@/components/status";
import { isActive } from "@/lib/events";
import { ago, duration, previewHost, short, stateTone, tokens } from "@/lib/format";
import type { SessionNode } from "@/lib/model";
import type { Tab } from "@/lib/selection";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

function Section({ title, children, className }: { readonly title: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { readonly children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function PreviewFrame({ url, commitId, note }: { readonly url: string; readonly commitId: string; readonly note: string }) {
  const [nonce, setNonce] = useState(0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex h-8 items-center gap-1.5 rounded-lg border bg-muted px-2">
        <StatusDot tone="ok" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{previewHost(url)}</span>
        <Button variant="ghost" size="icon-xs" onClick={() => setNonce((n) => n + 1)} aria-label="Reload preview">
          <RefreshCw />
        </Button>
        <Button variant="ghost" size="icon-xs" asChild>
          <a href={url} target="_blank" rel="noreferrer" aria-label="Open preview in a new tab">
            <ExternalLink />
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Built from <span className="font-mono">{short(commitId)}</span>. {note}
      </p>
      <iframe key={nonce} src={url} title="Live preview" className="min-h-[420px] w-full flex-1 rounded-lg border bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>
  );
}

function PreviewTab({ node }: { readonly node: SessionNode | null }) {
  const { features, openFeature } = useWorkspace();
  if (node) {
    const preview = node.live?.preview ?? node.record?.preview ?? null;
    if (!preview) return <Empty>No preview yet. kargah builds one from the first commit on the fork.</Empty>;
    return <PreviewFrame url={preview.url} commitId={preview.commitId} note={node.state === "merged" ? "This session merged." : `Branch preview/${node.record?.previewKey ?? node.featureId}.`} />;
  }
  const withPreviews = features.filter((f) => f.preview);
  if (!withPreviews.length) return <Empty>No feature has a preview yet.</Empty>;
  return (
    <Section title="Feature previews">
      <ul className="flex flex-col gap-1.5">
        {withPreviews.map((f) => (
          <li key={f.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm">
            <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => openFeature(f.id)}>
              {f.title}
            </button>
            <a href={f.preview?.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={`Open the ${f.title} preview`}>
              <ExternalLink className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function FileDiff({ path, before, after }: { readonly path: string; readonly before: string | null; readonly after: string | null }) {
  const [open, setOpen] = useState(false);
  const parts = useMemo(() => diffLines(before ?? "", after ?? ""), [before, after]);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
  const kind = before === null ? "added" : after === null ? "deleted" : "changed";
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/60">
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
        {kind !== "changed" ? <span className="text-muted-foreground">{kind}</span> : null}
        <span className="font-mono text-ok">+{added}</span>
        <span className="font-mono text-bad">−{removed}</span>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-96 overflow-auto bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
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

function ChangesTab({ node }: { readonly node: SessionNode | null }) {
  const { api, data } = useWorkspace();
  const head = node?.live?.commits.at(-1)?.id ?? node?.record?.head ?? "";
  const changes = useFetch(node ? () => api.changes(node.id) : null, `${node?.id}:${head}`);
  if (!node) {
    const recent = [...data.live.merges.map((m) => ({ ...m, kind: "merged" })), ...data.live.reverts.map((r) => ({ ...r, sessionId: "", kind: "reverted" }))].sort((a, b) => b.at - a.at).slice(0, 30);
    return (
      <Section title="Main">
        {recent.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {recent.map((m) => (
              <li key={`${m.kind}-${m.commitId}`} className="flex items-center gap-2">
                <ToneBadge tone={m.kind === "merged" ? "ok" : "bad"}>{m.kind}</ToneBadge>
                <span className="font-mono text-xs">{short(m.commitId)}</span>
                <span className="min-w-0 flex-1 truncate">{m.featureId}</span>
                <span className="text-xs text-muted-foreground">{ago(m.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing merged since this page opened.</Empty>
        )}
      </Section>
    );
  }
  if (changes.loading && !changes.data) return <Skeleton className="h-40" />;
  if (changes.error) return <Empty>{changes.error}</Empty>;
  const files = changes.data?.files ?? [];
  if (!files.length) return <Empty>The fork has no changes against main yet.</Empty>;
  return (
    <Section title={<>Against main {short(changes.data?.base)} · {files.length} files</>}>
      <div className="overflow-hidden rounded-lg border">
        {files.map((f) => (
          <FileDiff key={f.path} path={f.path} before={f.before} after={f.after} />
        ))}
      </div>
    </Section>
  );
}

function ArtifactsTab({ node }: { readonly node: SessionNode | null }) {
  const { api, data, selection, sessions, openSession, features } = useWorkspace();
  const featureId = node?.featureId ?? selection.feature;
  const forks = sessions.filter((s) => !featureId || s.featureId === featureId);
  const turns = useFetch(node ? () => api.turns(node.id) : null, `${node?.id}:${node?.live?.commits.length ?? node?.record?.commits.length ?? 0}`);
  const branches = features.filter((f) => f.preview).map((f) => f.id);
  return (
    <div className="flex flex-col gap-4">
      <Section title="Cloudflare Artifacts · namespace kargah">
        <div className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Server className="size-4 text-muted-foreground" />
            <span className="flex-1 font-mono">{selection.project}</span>
            <ToneBadge tone="idle">canonical</ToneBadge>
          </div>
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
            <dt className="text-muted-foreground">main</dt>
            <dd className="font-mono">{short(data.spec?.commitId) || "not created"}</dd>
            <dt className="text-muted-foreground">Writes</dt>
            <dd className="flex items-center gap-1">
              <Lock className="size-3" />
              only the merge gate
            </dd>
            <dt className="text-muted-foreground">Previews</dt>
            <dd className="font-mono">{branches.length ? branches.map((b) => `preview/${b}`).join(", ") : "none"}</dd>
          </dl>
        </div>
      </Section>
      <Section title={featureId ? `Forks for ${featureId}` : "Forks"}>
        {forks.length ? (
          <ul className="flex flex-col gap-1.5 border-l pl-3">
            {[...forks].reverse().map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => openSession(s.id)} className={cn("flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left text-xs hover:bg-muted/60", node?.id === s.id && "border-run/40 bg-run/5")}>
                  <span className="flex items-center gap-2 text-sm">
                    <GitFork className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.record?.fork ?? s.live?.fork ?? s.id}</span>
                    <StateBadge state={s.state} />
                  </span>
                  <span className="text-muted-foreground">
                    head <span className="font-mono">{short(s.record?.head ?? s.live?.commits.at(-1)?.id) || "none"}</span> · base main <span className="font-mono">{short(s.record?.baseMain) || "none"}</span> · {s.record?.commits.length ?? s.live?.commits.length ?? 0} commits
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No forks yet. Each session works in its own fork of {selection.project}.</Empty>
        )}
      </Section>
      {node ? (
        <Section title="Commits on this fork, with the prompt in git notes">
          {turns.loading && !turns.data ? <Skeleton className="h-24" /> : null}
          {turns.error ? <Empty>{turns.error}</Empty> : null}
          <ul className="flex flex-col gap-1.5">
            {(turns.data ?? []).map((t) => (
              <li key={t.commitId}>
                <Collapsible className="rounded-lg border">
                  <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/60">
                    <span className="font-mono">{short(t.commitId)}</span>
                    {t.note ? <ToneBadge tone="idle">{t.note.role}</ToneBadge> : null}
                    <span className="min-w-0 flex-1 truncate">{t.message.split("\n")[0]}</span>
                    <span className="text-muted-foreground">{t.timestamp ? ago(t.timestamp) : ""}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t px-2.5 py-2 text-xs">
                    {t.note ? (
                      <>
                        <div className="mb-1 text-muted-foreground">
                          {t.note.kind} · {t.note.model} · {t.note.paths.length} files
                        </div>
                        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{t.note.prompt}</pre>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No note on this commit.</span>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function SandboxTab({ node }: { readonly node: SessionNode | null }) {
  const { api, sessions, openSession } = useWorkspace();
  const status = useFetch(node ? () => api.sandbox(node.id) : null, `${node?.id}:${node?.state}:${Math.floor((node?.live?.timeline.length ?? 0) / 20)}`);
  if (!node) {
    const busy = sessions.filter((s) => s.state === "testing" || s.state === "coding" || s.state === "gating");
    return (
      <Section title="Sandboxes in use">
        {busy.length ? (
          <ul className="flex flex-col gap-1.5">
            {busy.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => openSession(s.id)} className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/60">
                  <Box className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs">{short(s.id, 9)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.featureId}</span>
                  <StateBadge state={s.state} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No sandbox is running a turn right now.</Empty>
        )}
      </Section>
    );
  }
  const job = node.state === "testing" || node.state === "coding" ? "runner.mjs, a coder turn" : node.state === "gating" ? "checks.mjs, the merge gate" : "none";
  const tools = (node.live?.timeline ?? []).filter((t) => t.kind === "tool" || t.kind === "error" || t.kind === "commit").slice(-40);
  const running = status.data?.running ?? false;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Coder sandbox">
        <div className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Box className="size-4 text-muted-foreground" />
            <span className="flex-1">Container</span>
            <ToneBadge tone={running ? "run" : "idle"}>
              <StatusDot tone={running ? "run" : "idle"} />
              {status.loading && !status.data ? "Checking" : running ? "Running" : "Stopped"}
            </ToneBadge>
          </div>
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Durable Object</dt>
            <dd className="font-mono">SessionAgent · {node.id}</dd>
            <dt className="text-muted-foreground">Job</dt>
            <dd>{job}</dd>
            <dt className="text-muted-foreground">Internet</dt>
            <dd>off; egress goes through the Worker's allowlist</dd>
            <dt className="text-muted-foreground">Push</dt>
            <dd>never; the Worker commits each turn</dd>
            {status.data?.exit ? (
              <>
                <dt className="text-muted-foreground">Last exit</dt>
                <dd>{status.data.exit}</dd>
              </>
            ) : null}
            {status.error ? (
              <>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{status.error}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </Section>
      <Section title="Activity">
        {tools.length ? (
          <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11.5px] leading-relaxed text-zinc-300">
            {tools
              .map((t) => (t.kind === "tool" ? `› ${t.tool} ${t.detail}` : t.kind === "error" ? `✗ ${t.message}` : t.kind === "commit" ? `✓ ${t.role} committed ${short(t.commitId)}` : ""))
              .join("\n")}
          </pre>
        ) : (
          <Empty>No tool calls yet.</Empty>
        )}
      </Section>
    </div>
  );
}

function Meter({ label, value, max, text }: { readonly label: string; readonly value: number; readonly max: number; readonly text: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">{text}</span>
      </div>
      <Progress value={pct} className={cn(pct >= 100 && "[&>*]:bg-bad")} aria-label={`${label} ${pct}%`} />
    </div>
  );
}

function BudgetTab({ node }: { readonly node: SessionNode | null }) {
  const { api } = useWorkspace();
  const detail = useFetch(node ? () => api.session(node.id) : null, `${node?.id}:${node?.state}:${node?.record?.updatedAt ?? 0}`);
  if (!node) return <Empty>Select a session to see its budget.</Empty>;
  if (detail.loading && !detail.data) return <Skeleton className="h-32" />;
  if (!detail.data) return <Empty>{detail.error ?? "No budget recorded."}</Empty>;
  const { record, budget } = detail.data;
  const usage = record.machine.usage;
  const elapsed = (isActive(record.machine.state) ? Date.now() : record.updatedAt) - usage.startedAt;
  return (
    <div className="flex flex-col gap-4">
      <Section title={`Budget for ${short(node.id, 9)}`}>
        <Meter label="Attempts" value={usage.attempts} max={budget.maxAttempts} text={`${usage.attempts} of ${budget.maxAttempts}`} />
        <Meter label="Tokens" value={usage.tokens} max={budget.maxTokens} text={`${tokens(usage.tokens)} of ${tokens(budget.maxTokens)}`} />
        <Meter label="Time" value={elapsed} max={budget.maxMillis} text={`${duration(elapsed)} of ${duration(budget.maxMillis)}`} />
      </Section>
      <Section title="Memory recalled">
        {node.live?.recalled.length ? (
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {node.live.recalled.map((p) => (
              <li key={p} className="truncate rounded-md border px-2 py-1">
                {p}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing recalled yet.</Empty>
        )}
      </Section>
      {record.history.length ? (
        <Section title="Feedback the agents got">
          <ul className="flex flex-col gap-1.5">
            {[...record.history].reverse().map((h, i) => (
              <li key={i}>
                <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{h}</pre>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Lineage">
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Attempt group</dt>
          <dd className="font-mono">{record.attempt.group}</dd>
          <dt className="text-muted-foreground">Follows</dt>
          <dd className="font-mono">{record.parent ?? "nothing, first session"}</dd>
          <dt className="text-muted-foreground">Preview key</dt>
          <dd className="font-mono">{record.previewKey}</dd>
        </dl>
      </Section>
    </div>
  );
}

const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: "preview", label: "Preview" },
  { value: "changes", label: "Changes" },
  { value: "artifacts", label: "Artifacts" },
  { value: "sandbox", label: "Sandbox" },
  { value: "budget", label: "Budget" },
];

export function Inspector() {
  const { selection, select, session, feature } = useWorkspace();
  const node = session ?? (feature ? ([...feature.sessions].reverse().find((s) => s.state !== "dropped") ?? feature.sessions.at(-1) ?? null) : null);
  return (
    <Tabs value={selection.tab} onValueChange={(v) => select({ tab: v as Tab })} className="flex h-full min-h-0 flex-col gap-0 bg-card">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <TabsList variant="line" className="h-8">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {node ? (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <GitBranch className="size-3" />
          <span className="font-mono">{short(node.id, 9)}</span>
          <StatusDot tone={stateTone(node.state)} />
          <span className="truncate">{node.featureId}</span>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col">
          <PreviewTab node={node} />
        </TabsContent>
        <TabsContent value="changes">
          <ChangesTab node={node} />
        </TabsContent>
        <TabsContent value="artifacts">
          <ArtifactsTab node={node} />
        </TabsContent>
        <TabsContent value="sandbox">
          <SandboxTab node={node} />
        </TabsContent>
        <TabsContent value="budget">
          <BudgetTab node={node} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
