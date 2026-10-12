import type { Ref } from "react";
import { Check, Circle, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Composer } from "@/components/composer";
import { FeatureBadge, StateBadge } from "@/components/status";
import { ago, previewHost, short } from "@/lib/format";
import type { FeatureNode } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace";

function acceptanceState(node: FeatureNode, id: string): { readonly tone: "ok" | "bad" | "idle"; readonly note: string } {
  const latest = [...node.sessions].reverse().find((s) => s.live?.gate);
  const gate = latest?.live?.gate;
  if (!gate) return { tone: "idle", note: node.status === "merged" ? "Merged before this page opened" : "Not gated yet" };
  const check = gate.checks.find((c) => c.name.includes(id));
  if (check) return { tone: check.ok ? "ok" : "bad", note: `${check.name} ${check.ok ? "passed" : "failed"} in ${short(latest.id, 9)}` };
  return { tone: gate.ok ? "ok" : "idle", note: gate.ok ? `Gate passed in ${short(latest.id, 9)}` : `Gate failed in ${short(latest.id, 9)}` };
}

export function FeatureView({ node, composerRef }: { readonly node: FeatureNode; readonly composerRef: Ref<HTMLTextAreaElement> }) {
  const { api, data, openSession } = useWorkspace();
  const spec = node.spec;
  const merges = data.live.merges.filter((m) => m.featureId === node.id);
  const reverts = data.live.reverts.filter((r) => r.featureId === node.id);
  const history = [...merges.map((m) => ({ kind: "merged" as const, commitId: m.commitId, at: m.at, text: `from ${short(m.sessionId, 9)}` })), ...reverts.map((r) => ({ kind: "reverted" as const, commitId: r.commitId, at: r.at, text: `reverted ${short(r.revertedCommit)}` }))].sort((a, b) => b.at - a.at);
  const send = async (text: string) => {
    try {
      const result = await api.prompt(`#${node.id} ${text}`);
      toast.success(result.sessionIds.length ? "Started a session on this feature" : "Answered", { description: result.answer?.text ?? result.sessionIds.join(", ") });
      data.refresh();
      if (result.sessionId) openSession(result.sessionId);
      return true;
    } catch (error) {
      toast.error("Not sent", { description: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-view="feature" data-feature={node.id}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-card px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Feature</span>
            <span className="font-mono">{node.id}</span>
            {!node.onMain ? <span>· not on main yet</span> : null}
          </div>
          <h1 className="truncate text-base font-semibold">{node.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FeatureBadge status={node.status} />
          {node.preview ? (
            <Button variant="outline" size="sm" asChild>
              <a href={node.preview.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                {previewHost(node.preview.url).split(".")[0]}
              </a>
            </Button>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border bg-card">
              <h2 className="flex items-center gap-2 border-b px-3.5 py-2 text-sm font-medium">
                Spec <span className="font-mono text-xs font-normal text-muted-foreground">spec/features/{node.id}.md</span>
              </h2>
              {spec ? (
                <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3.5 py-3 text-sm">
                  <dt className="text-muted-foreground">Entrypoint</dt>
                  <dd className="font-mono text-xs leading-5">{spec.entrypoint}</dd>
                  <dt className="text-muted-foreground">Flow</dt>
                  <dd>{spec.flow ?? spec.id}</dd>
                  <dt className="text-muted-foreground">Revision</dt>
                  <dd>{spec.revision}</dd>
                  <dt className="text-muted-foreground">Preview branch</dt>
                  <dd className="font-mono text-xs leading-5">preview/{node.id}</dd>
                  {spec.shared.length ? (
                    <>
                      <dt className="text-muted-foreground">Shared</dt>
                      <dd className="font-mono text-xs leading-5">{spec.shared.join(", ")}</dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className="px-3.5 py-3 text-sm text-muted-foreground">The planner has not written a spec for this feature yet.</p>
              )}
              {spec?.body ? <p className="border-t px-3.5 py-3 text-sm whitespace-pre-wrap text-muted-foreground">{spec.body}</p> : null}
            </section>
            <section className="rounded-xl border bg-card">
              <h2 className="border-b px-3.5 py-2 text-sm font-medium">Acceptance criteria</h2>
              <ul className="flex flex-col gap-2.5 px-3.5 py-3">
                {(spec?.acceptance ?? []).map((ac) => {
                  const state = acceptanceState(node, ac.id);
                  return (
                    <li key={ac.id} className="flex gap-2 text-sm">
                      {state.tone === "ok" ? <Check className="mt-0.5 size-4 shrink-0 text-ok" /> : state.tone === "bad" ? <X className="mt-0.5 size-4 shrink-0 text-bad" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                      <span>
                        <span className="font-mono text-xs font-medium">{ac.id}</span> {ac.text}
                        <span className="block text-xs text-muted-foreground">{state.note}</span>
                      </span>
                    </li>
                  );
                })}
                {!spec?.acceptance.length ? <li className="text-sm text-muted-foreground">None yet.</li> : null}
              </ul>
            </section>
          </div>
          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-3.5 py-2 text-sm font-medium">Sessions</h2>
            {node.sessions.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Commits</TableHead>
                    <TableHead>Fork</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...node.sessions].reverse().map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => openSession(s.id)}>
                      <TableCell>
                        <button type="button" className="font-mono text-xs text-run hover:underline" onClick={() => openSession(s.id)}>
                          {s.id}
                        </button>
                      </TableCell>
                      <TableCell>{s.attempt ? `${s.attempt.index} of ${s.attempt.of}` : ""}</TableCell>
                      <TableCell>
                        <StateBadge state={s.state} />
                      </TableCell>
                      <TableCell>{s.record?.commits.length ?? s.live?.commits.length ?? 0}</TableCell>
                      <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">{s.record?.fork ?? s.live?.fork}</TableCell>
                      <TableCell className="text-muted-foreground">{ago(s.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-3.5 py-3 text-sm text-muted-foreground">No session has worked on this feature yet. Ask for a change below to start one.</p>
            )}
          </section>
          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-3.5 py-2 text-sm font-medium">History on main</h2>
            <ul className="flex flex-col gap-1.5 px-3.5 py-3 text-sm">
              {history.map((h) => (
                <li key={`${h.kind}-${h.commitId}`} className="flex items-center gap-2">
                  <span className={h.kind === "merged" ? "text-ok" : "text-bad"}>{h.kind}</span>
                  <span className="font-mono text-xs">{short(h.commitId)}</span>
                  <span className="flex-1 text-muted-foreground">{h.text}</span>
                  <span className="text-xs text-muted-foreground">{ago(h.at)}</span>
                </li>
              ))}
              {history.length === 0 ? <li className="text-muted-foreground">{node.onMain ? "Merged before this page opened." : "Nothing merged yet."}</li> : null}
            </ul>
          </section>
        </div>
      </div>
      <Composer ref={composerRef} key={node.id} placeholder={`Ask for a change to ${node.title}`} target={`#${node.id}`} note="Starts a session on this feature" onSend={send} />
    </div>
  );
}
