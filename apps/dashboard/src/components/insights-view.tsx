import { useWorkspace } from "@/lib/workspace";
import { lessonsWithRecalls, metrics } from "@/lib/events";
import { ago, short } from "@/lib/format";

function Stat({ label, value, hint }: { readonly label: string; readonly value: string | number; readonly hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-card px-4 py-3">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function InsightsView() {
  const { data, openSession } = useWorkspace();
  const m = metrics(data.live);
  const lessons = lessonsWithRecalls(data.live);
  const picks = data.live.order.flatMap((id) => data.live.sessions[id]?.timeline.filter((t) => t.kind === "picked" && t.won).map((t) => ({ id, t })) ?? []);
  return (
    <div className="flex h-full min-h-0 flex-col" data-view="insights">
      <header className="border-b bg-card px-5 py-3">
        <div className="text-xs text-muted-foreground">Project</div>
        <h1 className="text-base font-semibold">Memory and learning</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Merged features" value={m.mergedFeatures} hint={`${m.merges} merges into main`} />
            <Stat label="Revert rate" value={`${Math.round(m.revertRate * 100)}%`} hint={`${m.reverts} reverts after main went red`} />
            <Stat label="Need you" value={m.stuck} hint="Stuck sessions waiting on a person" />
            <Stat label="Running" value={m.running} hint={`${m.sessions} sessions in total`} />
          </div>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Lessons</h2>
            <p className="text-xs text-muted-foreground">A lesson is written when a merge is reverted, and sessions on that feature recall it later. Own-feature recalls so far: {m.lessonRecalls}.</p>
            <ul className="flex flex-col gap-1.5">
              {lessons.map((l) => (
                <li key={l.path} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{l.path}</span>
                  <span className="text-xs text-muted-foreground">recalled {l.recalls} times</span>
                </li>
              ))}
              {lessons.length === 0 ? <li className="text-sm text-muted-foreground">No lessons yet.</li> : null}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Learned lint rules</h2>
            <p className="text-xs text-muted-foreground">The gardener turns corrections that repeat across sessions into project lint rules. {data.live.corrections.length} corrections recorded.</p>
            <ul className="flex flex-col gap-1.5">
              {data.live.rules.map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{r.id}</span>
                  <span>{r.message}</span>
                  <span className="text-xs text-muted-foreground">from {r.sessions.map((s) => short(s, 9)).join(", ")}</span>
                </li>
              ))}
              {data.live.rules.length === 0 ? <li className="text-sm text-muted-foreground">No learned rules yet.</li> : null}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Parallel attempts</h2>
            <ul className="flex flex-col gap-1.5">
              {picks.map(({ id, t }) =>
                t.kind === "picked" ? (
                  <li key={`${id}-${t.at}`} className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 text-sm">
                    <button type="button" className="text-left font-mono text-xs text-run hover:underline" onClick={() => openSession(id)}>
                      {short(id, 9)} won
                    </button>
                    <span className="text-xs text-muted-foreground">{t.candidates.map((c) => `${short(c.sessionId, 9)} ${c.passed}/${c.total}`).join(", ")}</span>
                  </li>
                ) : null,
              )}
              {picks.length === 0 ? <li className="text-sm text-muted-foreground">No attempt has been picked yet.</li> : null}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Spoken requests</h2>
            <ul className="flex flex-col gap-1.5">
              {[...data.live.voice].reverse().map((v) => (
                <li key={`${v.at}-${v.prompt}`} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">“{v.prompt}”</span>
                  <span className="text-xs text-muted-foreground">
                    {v.intent} {v.featureId ?? ""} · {ago(v.at)}
                  </span>
                </li>
              ))}
              {data.live.voice.length === 0 ? <li className="text-sm text-muted-foreground">Nothing said yet. Use the Talk button.</li> : null}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
