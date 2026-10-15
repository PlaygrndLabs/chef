import { useLayoutEffect, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { useAgent, useCopilotKit, UseAgentUpdate } from "@copilotkit/react-core/v2";
import type { RouteDecision } from "@chef/core";
import { AudioLines, Check, ChevronRight, Loader2, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Composer } from "@/components/composer";
import { LivePanel } from "@/components/live-talk";
import { ChatSkeleton } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status";
import { nodeStatus, waitsForBudget, waitsForKey, waitsForMerge, type FeatureStatus, type SessionNode } from "@/lib/model";
import { activity, stripFeatureTag } from "@/lib/progress";
import { isActive, routeAnswers } from "@/lib/events";
import { useNow } from "@/lib/live";
import { sendError } from "@/lib/send";
import type { OverviewState, Suggestion } from "@/lib/api";
import { useOverview } from "@/lib/overview";
import { plainVoiceError, startLive, useTalk, type TalkState } from "@/lib/live-talk";
import { useWorkspace } from "@/lib/workspace";
import { host } from "@/host";
import { Mark, Wordmark } from "@/components/logo";

const useProjectLevel = host.useProjectLevel ?? (() => null);

interface Sent {
  readonly seen: number;
  readonly failed: boolean;
  readonly reason?: string;
}

const sentHere = new Map<string, Sent>();
const sentWatchers = new Set<() => void>();
let sentVersion = 0;
let delivering: Promise<void> = Promise.resolve();
const QUEUE_WAIT_MS = 180_000;

function setSent(prompt: string, sent: Sent, moveToEnd: boolean): void {
  if (moveToEnd) sentHere.delete(prompt);
  sentHere.set(prompt, sent);
  sentVersion += 1;
  for (const watch of sentWatchers) watch();
}

function useSent(): number {
  return useSyncExternalStore(
    (watch) => {
      sentWatchers.add(watch);
      return () => sentWatchers.delete(watch);
    },
    () => sentVersion,
  );
}

const EXAMPLES = ["A todo list where I can add items", "Let me mark an item as done", "A page that lists my orders"];

function Avatar() {
  return <Mark />;
}

function You({ children }: { readonly children: React.ReactNode }) {
  return <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">{children}</div>;
}

function Said({ speaker, text, live }: { readonly speaker: "you" | "chef"; readonly text: string; readonly live: boolean }) {
  const mark = <AudioLines className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="spoken" />;
  if (speaker === "you")
    return (
      <div className="flex max-w-[80%] items-start gap-2 self-end rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm" data-spoken="you" data-live={live}>
        {mark}
        <span className="whitespace-pre-wrap">{text}</span>
      </div>
    );
  return (
    <div className="flex gap-3" data-spoken="chef" data-live={live}>
      <Avatar />
      <p className="flex min-w-0 flex-1 items-start gap-2 pt-1 text-sm">
        {mark}
        <span className="whitespace-pre-wrap">{text}</span>
      </p>
    </div>
  );
}

export function FeatureCard({ node }: { readonly node: SessionNode }) {
  const { features, openSession } = useWorkspace();
  const title = features.find((f) => f.id === node.featureId)?.title ?? node.record?.plan.feature.title ?? node.featureId;
  const tries = node.attempt && node.attempt.of > 1 && isActive(node.state) ? `Trying ${node.attempt.of} ways at once · ` : "";
  const line = waitsForBudget(node) ? `Paused. ${waitsForBudget(node)}` : waitsForKey(node) ? `Needs ${node.needs.join(", ")}. Open it to add ${node.needs.length === 1 ? "the key" : "the keys"}.` : waitsForMerge(node) ? "Passed every check. Open it to merge it into main." : `${tries}${activity(node.state, node.live?.timeline ?? [], node.live?.stuck ?? null)}`;
  return (
    <button type="button" onClick={() => openSession(node.id)} data-session={node.id} data-state={node.state} className="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left hover:bg-muted/60">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">{line}</span>
      </span>
      <StatusPill status={nodeStatus(node)} />
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}

const RANK: Readonly<Record<FeatureStatus, number>> = { merged: 0, done: 1, ready: 2, building: 3, stuck: 4, proposed: 5, dropped: 6 };

export function onePerFeature(sessions: readonly SessionNode[]): SessionNode[] {
  const best = new Map<string, SessionNode>();
  for (const s of sessions) {
    const current = best.get(s.featureId);
    if (!current || RANK[nodeStatus(s)] < RANK[nodeStatus(current)]) best.set(s.featureId, s);
  }
  return [...best.values()];
}

function replyFor(decision: RouteDecision, title: string | null, attempts: number, parts: number): string {
  if (decision.intent === "question") return "No answer was saved for this question.";
  if (parts > 1) return `On it. This is ${parts} features, so Chef builds them at the same time.`;
  const parallel = attempts > 1 ? ` I'm trying ${attempts} approaches at once and will keep the best one.` : "";
  const hotfix = decision.hotfix ? " It's a hotfix, so it is merged before other builds." : "";
  if (decision.intent === "chore") return `On it. This is a chore outside any one feature, so every merged feature gets checked again before it is merged.${hotfix}`;
  if (decision.intent === "change_feature") return `On it. This changes ${title ?? "an existing feature"}.${hotfix || parallel}`;
  return `On it. This is a new feature.${hotfix || parallel}`;
}

function Reply({ text, sessions, waiting = false }: { readonly text: string; readonly sessions: readonly SessionNode[]; readonly waiting?: boolean }) {
  const shown = onePerFeature(sessions);
  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        {waiting ? (
          <p className="flex items-center gap-3 text-sm text-muted-foreground" data-answer="waiting">
            Looking into it
            <Loader2 className="size-4 animate-spin" />
          </p>
        ) : text ? (
          <p className="text-sm whitespace-pre-wrap">{text}</p>
        ) : null}
        {shown.map((s) => (
          <FeatureCard key={s.id} node={s} />
        ))}
      </div>
    </div>
  );
}

function Welcome({ onExample }: { readonly onExample: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-3 pt-12 pb-4 text-center @lg:pt-20" data-view="welcome">
      <Wordmark className="mb-2 h-11" />
      <h2 className="text-xl font-medium tracking-tight">What should we build?</h2>
      <p className="max-w-md text-muted-foreground">Describe a feature in plain words. Chef plans it, writes the tests and the code, checks it, and merges it into main.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => onExample(e)} className="border px-3.5 py-1.5 text-sm hover:bg-muted">
            {e}
          </button>
        ))}
      </div>
      <ol className="mt-8 grid w-full gap-3 text-left @2xl:grid-cols-3">
        {[
          ["Describe it", "Type or talk. One sentence is enough."],
          ["Chef builds it", "In its own sandbox, with tests and a review."],
          ["Try it", "Every feature runs as its own app, with the whole stack."],
        ].map(([title, text], i) => (
          <li key={title} className="rounded-xl border p-4">
            <span className="mb-2.5 block font-mono text-xs text-brand">{String(i + 1).padStart(2, "0")}</span>
            <span className="block font-medium">{title}</span>
            <span className="text-sm text-muted-foreground">{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function OverviewMessage(props: { readonly state: OverviewState; readonly started: (prompt: string) => boolean; readonly onStart: (suggestions: readonly Suggestion[]) => void; readonly onReadAgain: () => void }) {
  const { state } = props;
  if (state.status === "none") return null;
  if (state.status === "reading")
    return (
      <div className="flex items-center gap-3" data-overview="reading">
        <Avatar />
        <span className="text-muted-foreground">Reading the code to see what this project does and what to pick up first</span>
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  if (state.status === "failed")
    return (
      <div className="flex gap-3" data-overview="failed">
        <Avatar />
        <div className="flex flex-col items-start gap-2 pt-0.5">
          <p className="text-sm">I could not read the code: {state.error}</p>
          <Button size="sm" variant="outline" onClick={props.onReadAgain}>
            Try again
          </Button>
        </div>
      </div>
    );
  const { overview } = state;
  const open = overview.suggestions.filter((s) => !props.started(s.prompt));
  return (
    <div className="flex gap-3" data-overview="ready">
      <Avatar />
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5 text-sm">
        <p className="whitespace-pre-wrap">{overview.summary}</p>
        {overview.problems.length > 0 ? (
          <div className="grid gap-1">
            <p>What looks unfinished:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {overview.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {overview.suggestions.length > 0 ? (
          <div className="grid gap-2">
            <p>A few things I could pick up now:</p>
            <div className="grid gap-1 rounded-xl border p-1.5" id="suggestions">
              {overview.suggestions.map((s) => {
                const started = props.started(s.prompt);
                return (
                  <button key={s.prompt} type="button" disabled={started} onClick={() => props.onStart([s])} data-suggestion={started ? "started" : "open"} className="group flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted/60 disabled:hover:bg-transparent">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{s.title}</span>
                      <span className="block text-sm text-muted-foreground">{s.why}</span>
                    </span>
                    {started ? <Check className="size-4 text-ok" aria-label="Started" /> : <Play className="size-4 text-muted-foreground group-hover:text-foreground" aria-label="Start" />}
                  </button>
                );
              })}
              {open.length > 1 ? (
                <div className="px-1.5 pt-1 pb-0.5">
                  <Button size="sm" variant="secondary" onClick={() => props.onStart(open)}>
                    Start all {open.length}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <button type="button" onClick={props.onReadAgain} className="self-start text-xs text-muted-foreground underline">
          Read the code again
        </button>
      </div>
    </div>
  );
}

const VOICE_MATCH_MS = 120_000;
const ANSWER_WAIT_MS = 10 * 60_000;

interface SaidTurn {
  readonly key: string;
  readonly speaker: "you" | "chef";
  readonly text: string;
  readonly at: number;
  readonly live: boolean;
}

export function spokenTurns(saved: readonly { readonly voiceSessionId: string; readonly speaker: "you" | "chef"; readonly text: string; readonly startedAt: number }[], talk: TalkState, project: string): SaidTurn[] {
  const mine = talk.project === project ? talk.sessionId : null;
  const on = talk.phase !== "off" && talk.project === project;
  const local = mine !== null && (on || !saved.some((t) => t.voiceSessionId === mine));
  const kept = saved.filter((t) => !(local && t.voiceSessionId === mine)).map((t, i) => ({ key: `${t.voiceSessionId}-${i}`, speaker: t.speaker, text: t.text, at: t.startedAt, live: false }));
  const heard = talk.project === project && (local || (on && mine === null)) ? talk.heard.filter((h) => h.text.trim()).map((h, i) => ({ key: `live-${i}`, speaker: h.speaker, text: h.text.trim(), at: h.at, live: on })) : [];
  return [...kept, ...heard];
}

interface ChatMessage {
  readonly id: string;
  readonly role: string;
  readonly content?: unknown;
}

function answerFor(messages: readonly ChatMessage[], prompt: string): string {
  let at = -1;
  messages.forEach((m, i) => {
    if (m.role === "user" && textOf(m.content) === prompt) at = i;
  });
  if (at < 0) return "";
  const after = messages.slice(at + 1);
  const stop = after.findIndex((m) => m.role === "user");
  return (stop < 0 ? after : after.slice(0, stop))
    .filter((m) => m.role === "assistant")
    .map((m) => textOf(m.content))
    .filter(Boolean)
    .join("\n\n");
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("");
  return "";
}

export function Home({ composerRef }: { readonly composerRef: Ref<HTMLTextAreaElement> }) {
  const { data, sessions, features, api, selection, app, openSettings } = useWorkspace();
  const talk = useTalk();
  const { state: overview, readAgain } = useOverview(api, selection.project);
  const [starting, setStarting] = useState<readonly string[]>([]);
  const { agent } = useAgent({ agentId: "default", updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged], throttleMs: 100 });
  const { copilotkit } = useCopilotKit();
  const [draft, setDraft] = useState<{ text: string; n: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useSent();
  const messages = agent.messages as unknown as readonly ChatMessage[];
  const routes = data.live.routes;
  const answers = routeAnswers(data.live);
  const now = useNow(10_000);

  const history = routes.map((route, index, list) => {
        const next = list[index + 1]?.at ?? Number.POSITIVE_INFINITY;
        const own = sessions.filter((s) => s.record?.rootPrompt === route.prompt && (s.version ?? 1) === 1 && s.createdAt >= route.at - 2000 && s.createdAt < next);
        const title = features.find((f) => f.id === (own[0]?.featureId ?? route.decision.featureId))?.title ?? null;
        const question = route.decision.intent === "question";
        const answer = question ? answers[index] || answerFor(messages, route.prompt) : "";
        const parts = new Set(own.map((s) => s.featureId)).size;
        const voiced = data.live.voice.some((v) => v.prompt === route.prompt && v.at >= route.at && v.at - route.at < VOICE_MATCH_MS);
        return { ...route, sessions: own, voiced, waiting: question && !answer && now - route.at < ANSWER_WAIT_MS, reply: answer || replyFor(route.decision, title, parts > 1 ? own.length / parts : own.length, parts) };
      });
  const said = spokenTurns(data.live.spoken, talk, selection.project);
  const timeline = [...history.map((item) => ({ at: item.at, item, turn: null })), ...said.map((turn) => ({ at: turn.at, item: null, turn }))].sort((a, b) => a.at - b.at);
  const pending = [...sentHere].filter(([prompt, sent]) => routes.filter((r) => r.prompt === prompt).length <= sent.seen).map(([prompt, sent]) => ({ prompt, failed: sent.failed, reason: sent.reason ?? null }));

  const loading = !data.ready || overview === null;
  useLayoutEffect(() => {
    if (!loading && (history.length || pending.length || said.length)) end.current?.scrollIntoView({ block: "end" });
  }, [loading, messages.length, history.length, pending.length, said.length, said[said.length - 1]?.text, talk.phase]);

  const deliver = (text: string, seen: number) =>
    new Promise<void>((settle) => {
      let accepted = false;
      let done = false;
      let reason: string | null = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (!accepted && sentHere.get(text)?.seen === seen) setSent(text, { seen, failed: true, ...(reason ? { reason } : {}) }, false);
        settle();
      };
      const watch = agent.subscribe({
        onStateSnapshotEvent: ({ event }) => {
          if ((event.snapshot as { prompt?: unknown } | undefined)?.prompt !== text) return;
          accepted = true;
          finish();
        },
        onRunErrorEvent: ({ event }) => {
          reason = sendError(event.message);
        },
      });
      if (agent.isRunning) agent.abortRun();
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
      copilotkit
        .runAgent({ agent })
        .catch(() => undefined)
        .finally(() => {
          watch.unsubscribe();
          finish();
        });
    });

  const send = (text: string) => {
    const seen = routes.filter((r) => r.prompt === text).length;
    setSent(text, { seen, failed: false }, true);
    const turn = delivering.then(() => deliver(text, seen));
    delivering = Promise.race([turn, new Promise<void>((resolve) => setTimeout(resolve, QUEUE_WAIT_MS))]);
    return true;
  };

  const started = (prompt: string) => starting.includes(prompt) || routes.some((r) => r.prompt === prompt);
  const start = (suggestions: readonly Suggestion[]) => {
    setStarting((list) => [...list, ...suggestions.map((s) => s.prompt)]);
    for (const s of suggestions)
      api.prompt(s.prompt).catch((error: unknown) => {
        setStarting((list) => list.filter((p) => p !== s.prompt));
        toast.error(`Could not start "${s.title}"`, { description: error instanceof Error ? error.message : String(error) });
      });
  };
  const introduced = overview !== null && overview.status !== "none";
  const welcome = !loading && !introduced && history.length === 0 && pending.length === 0 && sessions.length === 0 && said.length === 0;
  const live = talk.phase !== "off" && talk.project === selection.project;
  const viewOnly = useProjectLevel(selection.project) === "view";
  const goLive = () => {
    if (app.available && app.settings && !app.settings.voice) {
      toast.error("Live talk needs a voice key", { description: "Add an OpenAI key under Settings, Models.", action: { label: "Open", onClick: () => openSettings("app", "models") } });
      return;
    }
    startLive(selection.project).catch((error: unknown) => toast.error("Live talk did not start", { description: plainVoiceError(error) }));
  };
  const busy = agent.isRunning || sessions.some((s) => isActive(s.state));
  return (
    <div className="@container relative flex h-full min-h-0 flex-col" data-view="project" id="chat">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
          {loading ? (
            <ChatSkeleton />
          ) : (
            <>
              {welcome ? <Welcome onExample={(text) => setDraft((d) => ({ text, n: (d?.n ?? 0) + 1 }))} /> : null}
              {overview && introduced ? <OverviewMessage state={overview} started={started} onStart={start} onReadAgain={() => void readAgain().catch((error: unknown) => toast.error("Could not start reading", { description: error instanceof Error ? error.message : String(error) }))} /> : null}
              {!welcome && !introduced && history.length === 0 && pending.length === 0 && said.length === 0 ? <p className="py-10 text-center text-muted-foreground">Pick a feature in the list, or describe a new one below.</p> : null}
              {timeline.map(({ item, turn }) =>
                turn ? (
                  <Said key={turn.key} speaker={turn.speaker} text={turn.text} live={turn.live} />
                ) : item && item.voiced ? (
                  item.sessions.length > 0 ? <Reply key={`${item.at}-${item.prompt}`} text="" sessions={item.sessions} /> : null
                ) : item ? (
                  <div key={`${item.at}-${item.prompt}`} className="flex flex-col gap-4">
                    <You>{stripFeatureTag(item.prompt).text}</You>
                    <Reply text={item.reply} sessions={item.sessions} waiting={item.waiting} />
                  </div>
                ) : null,
              )}
              {pending.map(({ prompt, failed, reason }) => (
                <div key={`pending-${prompt}`} className="flex flex-col gap-4" data-pending={failed ? "failed" : "sending"}>
                  <You>{prompt}</You>
                  <div className="flex items-center gap-3">
                    <Avatar />
                    {failed ? (
                      <>
                        <span className="text-muted-foreground">{reason ? `Chef could not take this message. ${reason}` : "This message did not reach Chef."}</span>
                        {viewOnly ? null : (
                          <Button size="sm" variant="outline" onClick={() => send(prompt)} data-retry={prompt}>
                            <RotateCcw className="size-3.5" />
                            Retry
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground">Thinking about where this belongs</span>
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        {live ? (
          <LivePanel />
        ) : (
          <div className="sticky bottom-0 bg-background">
            {viewOnly ? (
              <p className="px-6 pt-2 pb-5 text-center text-xs text-muted-foreground" id="view-only">
                You can view this project. Ask someone who manages it to let you edit.
              </p>
            ) : (
              <Composer ref={composerRef} placeholder="Describe a feature or a change" hint={busy ? "Chef is working. You can keep typing." : "Chef figures out which feature it belongs to. Start with /hotfix or /chore for those."} onSend={send} draft={draft} onLive={goLive} />
            )}
          </div>
        )}
        <div ref={end} />
      </div>
    </div>
  );
}
