import { useEffect, useMemo, useRef, type Ref } from "react";
import { useAgent, useCopilotKit, UseAgentUpdate } from "@copilotkit/react-core/v2";
import type { KargahState } from "@kargah/adapters/agui";
import type { RouteDecision } from "@kargah/core";
import { Hammer, Route, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/composer";
import { SessionCard } from "@/components/session-card";
import { ToneBadge } from "@/components/status";
import type { SessionNode } from "@/lib/model";
import { ago, short } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";

const sentHere = new Set<string>();

function intentLabel(decision: RouteDecision): string {
  if (decision.intent === "new_feature") return "New feature";
  if (decision.intent === "change_feature") return `Change${decision.changeKind ? ` (${decision.changeKind})` : ""}`;
  return "Question";
}

function RouteReply({ decision, sessions, at }: { readonly decision: RouteDecision; readonly sessions: readonly SessionNode[]; readonly at: number }) {
  const feature = sessions[0]?.featureId ?? decision.featureId;
  return (
    <div className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand text-xs font-semibold text-brand-foreground">k</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm">
          {decision.intent === "question" ? "Answered from project memory." : `Routed as ${intentLabel(decision).toLowerCase()} for `}
          {decision.intent === "question" ? null : <span className="font-mono">{feature ?? "a new feature"}</span>}
          {decision.intent !== "question" && sessions.length > 1 ? ` with ${sessions.length} parallel attempts.` : decision.intent === "question" ? null : "."}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <ToneBadge tone="idle">
            <Route className="size-3" />
            {intentLabel(decision)}
          </ToneBadge>
          <ToneBadge tone="idle">
            {decision.via === "classifier" ? "Jev" : decision.via} {decision.confidence.toFixed(2)}
          </ToneBadge>
          <span>{ago(at)}</span>
        </div>
        {sessions.length ? (
          <div className="flex flex-col gap-1.5">
            {sessions.map((s) => (
              <SessionCard key={s.id} node={s} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Bubble({ children }: { readonly children: React.ReactNode }) {
  return <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap">{children}</div>;
}

interface ChatMessage {
  readonly id: string;
  readonly role: string;
  readonly content?: unknown;
  readonly toolCalls?: readonly { readonly id: string; readonly function: { readonly name: string; readonly arguments: string } }[];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("");
  return "";
}

function toolDetail(args: string): string {
  try {
    const parsed = JSON.parse(args) as { session?: string; detail?: string };
    return [parsed.detail, parsed.session ? `in ${short(parsed.session, 9)}` : ""].filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

function LiveChat({ composerRef }: { readonly composerRef: Ref<HTMLTextAreaElement> }) {
  const { data, sessions } = useWorkspace();
  const { agent } = useAgent({ agentId: "default", updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged], throttleMs: 100 });
  const { copilotkit } = useCopilotKit();
  const end = useRef<HTMLDivElement>(null);
  const messages = agent.messages as unknown as readonly ChatMessage[];
  const state = agent.state as Partial<KargahState> | undefined;
  const liveIds = Object.keys(state?.sessions ?? {});
  const liveNodes = liveIds.map((id) => sessions.find((s) => s.id === id)).filter((s): s is SessionNode => Boolean(s));

  const history = useMemo(
    () =>
      data.live.routes
        .filter((r) => !sentHere.has(r.prompt))
        .map((route, index, list) => {
          const next = list[index + 1]?.at ?? Number.POSITIVE_INFINITY;
          const own = sessions.filter((s) => s.record?.rootPrompt === route.prompt && s.createdAt >= route.at - 2000 && s.createdAt < next);
          return { ...route, sessions: own };
        }),
    [data.live.routes, sessions],
  );

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, history.length]);

  const send = async (text: string) => {
    sentHere.add(text);
    if (agent.isRunning) agent.abortRun();
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
    copilotkit.runAgent({ agent }).catch((error: unknown) => toast.error("The request failed", { description: error instanceof Error ? error.message : String(error) }));
    return true;
  };

  const empty = history.length === 0 && messages.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col" id="chat">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          {empty ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Sparkles className="size-6 text-brand" />
              <h2 className="text-lg font-semibold">What should kargah build?</h2>
              <p className="max-w-md text-sm text-muted-foreground">Describe a feature or a change. Jev routes it to the right feature, kargah plans it, writes tests, codes it in a sandbox and merges it once the gate passes. Mention a feature with # to change it.</p>
            </div>
          ) : null}
          {history.map((item) => (
            <div key={`${item.at}-${item.prompt}`} className="flex flex-col gap-3">
              <Bubble>{item.prompt}</Bubble>
              <RouteReply decision={item.decision} sessions={item.sessions} at={item.at} />
            </div>
          ))}
          {messages.map((m, index) => {
            if (m.role === "user") return <Bubble key={m.id}>{textOf(m.content)}</Bubble>;
            if (m.role === "assistant") {
              const text = textOf(m.content);
              const first = messages.slice(0, index).findLast((p) => p.role !== "tool")?.role !== "assistant";
              return (
                <div key={m.id} className={first ? "flex gap-3" : "-mt-2.5 flex gap-3"}>
                  {first ? <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand text-xs font-semibold text-brand-foreground">k</span> : <span className="w-7 shrink-0" />}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {text ? <p className="text-sm whitespace-pre-wrap">{text}</p> : null}
                    {m.toolCalls?.map((call) => (
                      <div key={call.id} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1 text-xs">
                        <Wrench className="size-3 text-muted-foreground" />
                        <span className="font-medium">{call.function.name}</span>
                        <span className="truncate font-mono text-muted-foreground">{toolDetail(call.function.arguments)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          })}
          {liveNodes.length ? (
            <div className="flex flex-col gap-1.5" id="live-sessions">
              {liveNodes.map((s) => (
                <SessionCard key={s.id} node={s} />
              ))}
            </div>
          ) : null}
          <div ref={end} />
        </div>
      </div>
      <Composer ref={composerRef} placeholder="Describe a feature or a change" target="Auto-route with Jev" note={agent.isRunning ? "Streaming the last request" : "Enter to send"} onSend={send} />
    </div>
  );
}

export function ProjectChat({ composerRef }: { readonly composerRef: Ref<HTMLTextAreaElement> }) {
  const { selection, data, api, features } = useWorkspace();
  const bootstrap = async () => {
    try {
      const result = await api.bootstrap();
      toast.success(result.created ? `Created ${selection.project} from the template` : `${selection.project} already exists`, { description: `main at ${short(result.commitId)}` });
      data.refresh();
    } catch (error) {
      toast.error("Bootstrap failed", { description: error instanceof Error ? error.message : String(error) });
    }
  };
  const building = features.filter((f) => f.status === "building").length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-card px-5 py-3">
        <div>
          <div className="text-xs text-muted-foreground">Project chat</div>
          <h1 className="text-base font-semibold">{selection.project}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {features.length} features · {building} building
          </span>
          {data.spec && !data.spec.commitId ? (
            <Button size="sm" onClick={() => void bootstrap()}>
              <Hammer />
              Create project
            </Button>
          ) : (
            <span className="font-mono">main {short(data.spec?.commitId)}</span>
          )}
        </div>
      </header>
      <LiveChat composerRef={composerRef} />
    </div>
  );
}
