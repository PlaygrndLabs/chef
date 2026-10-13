import { useEffect, useRef, useState, type Ref } from "react";
import { useAgent, useCopilotKit, UseAgentUpdate } from "@copilotkit/react-core/v2";
import type { RouteDecision, SessionState } from "@chef/core";
import { Check, ChevronRight, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Composer } from "@/components/composer";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status";
import { waitsForKey, type FeatureStatus, type SessionNode } from "@/lib/model";
import { activity, stripFeatureTag } from "@/lib/progress";
import { isActive } from "@/lib/events";
import type { OverviewState, Suggestion } from "@/lib/api";
import { useOverview } from "@/lib/overview";
import { useWorkspace } from "@/lib/workspace";

const sentHere = new Map<string, number>();

const EXAMPLES = ["A todo list where I can add items", "Let me mark an item as done", "A page that lists my orders"];

export function statusOf(state: SessionState): FeatureStatus {
  if (state === "merged") return "merged";
  if (state === "stuck") return "stuck";
  if (state === "dropped") return "dropped";
  return "building";
}

function Avatar() {
  return <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand text-xs font-semibold text-brand-foreground">c</span>;
}

function You({ children }: { readonly children: React.ReactNode }) {
  return <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[15px] whitespace-pre-wrap">{children}</div>;
}

export function FeatureCard({ node }: { readonly node: SessionNode }) {
  const { features, openSession } = useWorkspace();
  const title = features.find((f) => f.id === node.featureId)?.title ?? node.record?.plan.feature.title ?? node.featureId;
  const tries = node.attempt && node.attempt.of > 1 && isActive(node.state) ? `Trying ${node.attempt.of} ways at once · ` : "";
  const line = waitsForKey(node) ? `Needs ${node.needs.join(", ")}. Open it to add ${node.needs.length === 1 ? "the key" : "the keys"}.` : `${tries}${activity(node.state, node.live?.timeline ?? [], node.live?.stuck ?? null)}`;
  return (
    <button type="button" onClick={() => openSession(node.id)} data-session={node.id} data-state={node.state} className="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left hover:bg-muted/60">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">{line}</span>
      </span>
      <StatusPill status={statusOf(node.state)} />
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}

const RANK: Readonly<Record<FeatureStatus, number>> = { merged: 0, building: 1, stuck: 2, proposed: 3, dropped: 4 };

export function onePerFeature(sessions: readonly SessionNode[]): SessionNode[] {
  const best = new Map<string, SessionNode>();
  for (const s of sessions) {
    const current = best.get(s.featureId);
    if (!current || RANK[statusOf(s.state)] < RANK[statusOf(current.state)]) best.set(s.featureId, s);
  }
  return [...best.values()];
}

function replyFor(decision: RouteDecision, title: string | null, attempts: number): string {
  if (decision.intent === "question") return "chef answered this before answers were saved, so the answer is not shown here.";
  const parallel = attempts > 1 ? ` I'm trying ${attempts} approaches at once and will keep the best one.` : "";
  const hotfix = decision.hotfix ? " It's a hotfix, so it goes live before other builds." : "";
  if (decision.intent === "chore") return `On it. This is a chore outside any one feature, so every live feature gets checked again before it goes live.${hotfix}`;
  if (decision.intent === "change_feature") return `On it. This changes ${title ?? "an existing feature"}.${hotfix || parallel}`;
  return `On it. This is a new feature.${hotfix || parallel}`;
}

function Reply({ text, sessions }: { readonly text: string; readonly sessions: readonly SessionNode[] }) {
  const shown = onePerFeature(sessions);
  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <p className="text-[15px] whitespace-pre-wrap">{text}</p>
        {shown.map((s) => (
          <FeatureCard key={s.id} node={s} />
        ))}
      </div>
    </div>
  );
}

function Welcome({ onExample }: { readonly onExample: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-3 pt-16 pb-4 text-center sm:pt-24" data-view="welcome">
      <span className="grid size-11 place-items-center rounded-xl bg-brand text-lg font-semibold text-brand-foreground">c</span>
      <h2 className="text-2xl font-semibold tracking-tight">What should we build?</h2>
      <p className="max-w-md text-muted-foreground">Describe a feature in plain words. chef plans it, writes the tests and the code, checks it, and puts it live.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => onExample(e)} className="rounded-full border px-3.5 py-1.5 text-sm hover:bg-muted">
            {e}
          </button>
        ))}
      </div>
      <ol className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">
        {[
          ["Describe it", "Type or talk. One sentence is enough."],
          ["chef builds it", "In its own sandbox, with tests and a review."],
          ["Try it live", "Every feature gets its own preview link."],
        ].map(([title, text], i) => (
          <li key={title} className="rounded-xl border p-4">
            <span className="mb-2.5 grid size-6 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
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
          <p className="text-[15px]">I could not read the code: {state.error}</p>
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
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5 text-[15px]">
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
  const { data, sessions, features, api } = useWorkspace();
  const { state: overview, readAgain } = useOverview(api);
  const [starting, setStarting] = useState<readonly string[]>([]);
  useEffect(() => {
    const again = () => void readAgain();
    window.addEventListener("chef:read-code", again);
    return () => window.removeEventListener("chef:read-code", again);
  }, [readAgain]);
  const { agent } = useAgent({ agentId: "default", updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged], throttleMs: 100 });
  const { copilotkit } = useCopilotKit();
  const [draft, setDraft] = useState<{ text: string; n: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = agent.messages as unknown as readonly ChatMessage[];
  const routes = data.live.routes;

  const history = routes.map((route, index, list) => {
        const next = list[index + 1]?.at ?? Number.POSITIVE_INFINITY;
        const own = sessions.filter((s) => s.record?.rootPrompt === route.prompt && s.createdAt >= route.at - 2000 && s.createdAt < next);
        const title = features.find((f) => f.id === (own[0]?.featureId ?? route.decision.featureId))?.title ?? null;
        const stored = data.live.answers.find((a) => a.prompt === route.prompt && a.at >= route.at && a.at < next)?.answer ?? "";
        const answer = route.decision.intent === "question" ? stored || answerFor(messages, route.prompt) : "";
        return { ...route, sessions: own, reply: answer || replyFor(route.decision, title, own.length) };
      });
  const pending = [...sentHere].filter(([prompt, seen]) => routes.filter((r) => r.prompt === prompt).length <= seen).map(([prompt]) => prompt);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, history.length, pending.length]);

  const send = async (text: string) => {
    sentHere.delete(text);
    sentHere.set(text, routes.filter((r) => r.prompt === text).length);
    if (agent.isRunning) agent.abortRun();
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
    copilotkit.runAgent({ agent }).catch((error: unknown) => toast.error("The request failed", { description: error instanceof Error ? error.message : String(error) }));
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
  const welcome = !introduced && history.length === 0 && pending.length === 0 && sessions.length === 0;
  const busy = agent.isRunning || sessions.some((s) => isActive(s.state));
  return (
    <div className="flex h-full min-h-0 flex-col" data-view="project" id="chat">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
          {welcome ? <Welcome onExample={(text) => setDraft((d) => ({ text, n: (d?.n ?? 0) + 1 }))} /> : null}
          {overview && introduced ? <OverviewMessage state={overview} started={started} onStart={start} onReadAgain={() => void readAgain().catch((error: unknown) => toast.error("Could not start reading", { description: error instanceof Error ? error.message : String(error) }))} /> : null}
          {!welcome && !introduced && history.length === 0 && pending.length === 0 ? <p className="py-10 text-center text-muted-foreground">Pick a feature on the left, or describe a new one below.</p> : null}
          {history.map((item) => (
            <div key={`${item.at}-${item.prompt}`} className="flex flex-col gap-4">
              <You>{stripFeatureTag(item.prompt).text}</You>
              <Reply text={item.reply} sessions={item.sessions} />
            </div>
          ))}
          {pending.map((prompt) => (
            <div key={`pending-${prompt}`} className="flex flex-col gap-4">
              <You>{prompt}</You>
              <div className="flex items-center gap-3">
                <Avatar />
                <span className="text-muted-foreground">{agent.isRunning ? "Thinking about where this belongs" : "No answer yet. Try sending it again."}</span>
                {agent.isRunning ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
      </div>
      <Composer ref={composerRef} placeholder="Describe a feature or a change" hint={busy ? "chef is working. You can keep typing." : "chef figures out which feature it belongs to. Start with /hotfix or /chore for those."} onSend={send} draft={draft} />
    </div>
  );
}
