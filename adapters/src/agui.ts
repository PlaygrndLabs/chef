import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import type { ChefEvent, SessionState, SubmitResult } from "@chef/core";

export interface ChefLink {
  cursor(): Promise<number>;
  submit(prompt: string): Promise<SubmitResult>;
  events(after: number): Promise<readonly { readonly seq: number; readonly event: ChefEvent }[]>;
}

export interface SessionView {
  readonly id: string;
  readonly featureId: string;
  readonly attempt: string;
  readonly state: SessionState;
  readonly preview: string | null;
  readonly review: string | null;
  readonly gate: string | null;
  readonly merged: string | null;
  readonly stuck: string | null;
  readonly commits: number;
}

export interface ChefState {
  readonly prompt: string;
  readonly intent: string | null;
  readonly featureId: string | null;
  readonly sessions: Readonly<Record<string, SessionView>>;
}

const TERMINAL: ReadonlySet<SessionState> = new Set(["merged", "stuck", "dropped"]);

export function isFinished(state: ChefState): boolean {
  const sessions = Object.values(state.sessions);
  return sessions.length > 0 && sessions.every((s) => TERMINAL.has(s.state));
}

function lastUserText(input: RunAgentInput): string {
  const message = [...input.messages].reverse().find((m) => m.role === "user");
  if (!message) return "";
  const content: unknown = message.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("").trim();
  return "";
}

export class SessionStream {
  private state: ChefState;
  private readonly openText = new Map<string, string>();
  private readonly steps = new Map<string, string>();
  private turn = 0;
  private toolCalls = 0;

  constructor(
    prompt: string,
    result: SubmitResult,
    private readonly ids: () => string,
  ) {
    this.state = { prompt, intent: result.decision.intent, featureId: result.featureId ?? result.decision.featureId ?? null, sessions: {} };
    for (const id of result.sessionIds) this.track(id, { id, featureId: this.state.featureId ?? "", attempt: "", state: "queued", preview: null, review: null, gate: null, merged: null, stuck: null, commits: 0 });
  }

  snapshot(): ChefState {
    return this.state;
  }

  follows(sessionId: string): boolean {
    return sessionId in this.state.sessions;
  }

  push(event: ChefEvent): BaseEvent[] {
    if (!("sessionId" in event) || typeof event.sessionId !== "string" || !this.follows(event.sessionId)) return [];
    const id = event.sessionId;
    const out: BaseEvent[] = [];
    const view = this.state.sessions[id] as SessionView;
    switch (event.type) {
      case "session.created":
        return this.update(id, { featureId: event.featureId, attempt: `${event.attempt.index}/${event.attempt.of}` });
      case "session.state": {
        out.push(...this.closeText(id));
        const current = this.steps.get(id);
        if (current) out.push({ type: EventType.STEP_FINISHED, stepName: current } as BaseEvent);
        const step = `${id}:${event.to}`;
        out.push({ type: EventType.STEP_STARTED, stepName: step } as BaseEvent);
        if (TERMINAL.has(event.to)) {
          out.push({ type: EventType.STEP_FINISHED, stepName: step } as BaseEvent);
          this.steps.delete(id);
        } else this.steps.set(id, step);
        return [...out, ...this.update(id, { state: event.to })];
      }
      case "coder.event":
        return this.coder(id, event.event);
      case "commit.created":
        return this.update(id, { commits: view.commits + 1 });
      case "preview.updated":
        return this.update(id, { preview: event.link ?? event.url });
      case "review.verdict":
        return this.update(id, { review: event.approve ? "approved" : `rejected: ${event.reasons.join("; ")}` });
      case "gate.result":
        return this.update(id, { gate: event.ok ? "passed" : `failed: ${event.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}` });
      case "main.merged":
        return this.update(id, { merged: event.commitId });
      case "session.stuck":
        return this.update(id, { stuck: event.reason });
      default:
        return [];
    }
  }

  private coder(id: string, event: Extract<ChefEvent, { type: "coder.event" }>["event"]): BaseEvent[] {
    if (event.type === "assistant.message_delta") {
      const out: BaseEvent[] = [];
      let messageId = this.openText.get(id);
      if (!messageId) {
        messageId = `${id}-turn-${++this.turn}`;
        this.openText.set(id, messageId);
        out.push({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
      }
      if (event.delta) out.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: event.delta } as BaseEvent);
      return out;
    }
    if (event.type === "tool.execution_start") {
      const out = this.closeText(id);
      const toolCallId = `${id}-tool-${++this.toolCalls}`;
      out.push(
        { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: event.tool } as BaseEvent,
        { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ session: id, detail: event.detail ?? "" }) } as BaseEvent,
        { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent,
        { type: EventType.TOOL_CALL_RESULT, messageId: this.ids(), toolCallId, content: "done", role: "tool" } as BaseEvent,
      );
      return out;
    }
    if (event.type === "session.idle") return this.closeText(id);
    return [...this.closeText(id), ...textMessage(this.ids(), `Session ${id} reported an error: ${event.message}`)];
  }

  closeAll(): BaseEvent[] {
    return Object.keys(this.state.sessions).flatMap((id) => this.closeText(id));
  }

  private closeText(id: string): BaseEvent[] {
    const messageId = this.openText.get(id);
    if (!messageId) return [];
    this.openText.delete(id);
    return [{ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent];
  }

  private track(id: string, view: SessionView): void {
    this.state = { ...this.state, sessions: { ...this.state.sessions, [id]: view } };
  }

  private update(id: string, patch: Partial<SessionView>): BaseEvent[] {
    const view = this.state.sessions[id];
    if (!view) return [];
    this.track(id, { ...view, ...patch });
    return [{ type: EventType.STATE_SNAPSHOT, snapshot: this.state } as BaseEvent];
  }
}

export function textMessage(messageId: string, text: string): BaseEvent[] {
  return [
    { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent,
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text } as BaseEvent,
    { type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent,
  ];
}

export function routeLine(result: SubmitResult): string {
  const d = result.decision;
  if (d.intent === "question") return result.answer?.text ?? "I could not find an answer in the project memory.";
  const target = result.featureId ?? d.featureId ?? "a new feature";
  const attempts = result.sessionIds.length > 1 ? ` with ${result.sessionIds.length} parallel attempts` : "";
  const lane = d.hotfix ? " as a hotfix, ahead of other builds" : "";
  return `Routed as ${d.intent.replace("_", " ")} for ${target}${attempts}${lane}. I will stream each session here until it merges or gets stuck.`;
}

export function summaryLine(state: ChefState): string {
  return Object.values(state.sessions)
    .map((s) => {
      if (s.state === "merged") return `${s.id} merged${s.merged ? ` as ${s.merged.slice(0, 12)}` : ""}${s.preview ? `; preview ${s.preview}` : ""}.`;
      if (s.state === "stuck") return `${s.id} is stuck: ${s.stuck ?? "no reason recorded"}.`;
      return `${s.id} was dropped.`;
    })
    .join("\n");
}

export interface ChefAgentOptions {
  readonly link: ChefLink;
  readonly pollMs?: number;
  readonly maxMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class ChefAgent extends AbstractAgent {
  private readonly options: ChefAgentOptions;

  constructor(options: ChefAgentOptions) {
    super({ description: "chef: routes a request to a feature, runs its sessions and streams them until they merge" });
    this.options = options;
  }

  override clone(): ChefAgent {
    const copy = super.clone() as ChefAgent;
    (copy as unknown as { options: ChefAgentOptions }).options = this.options;
    return copy;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let cancelled = false;
      const emit = (events: readonly BaseEvent[]) => {
        for (const event of events) if (!cancelled) subscriber.next(event);
      };
      const { threadId, runId } = input;
      const ids = () => crypto.randomUUID();
      const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      const work = async () => {
        emit([{ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent]);
        const prompt = lastUserText(input);
        if (!prompt) {
          emit(textMessage(ids(), "Describe a feature or a change and I will build it."));
          emit([{ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent]);
          return;
        }
        const link = this.options.link;
        let after = await link.cursor();
        const result = await link.submit(prompt);
        const stream = new SessionStream(prompt, result, ids);
        emit(textMessage(ids(), routeLine(result)));
        emit([{ type: EventType.STATE_SNAPSHOT, snapshot: stream.snapshot() } as BaseEvent]);
        const started = Date.now();
        while (!cancelled && result.sessionIds.length > 0 && !isFinished(stream.snapshot())) {
          const batch = await link.events(after);
          for (const entry of batch) {
            after = Math.max(after, entry.seq);
            emit(stream.push(entry.event));
          }
          if (isFinished(stream.snapshot())) break;
          if (Date.now() - started > (this.options.maxMs ?? 6 * 60 * 60 * 1000)) {
            emit(textMessage(ids(), "Still running. The dashboard keeps showing the sessions."));
            break;
          }
          if (batch.length === 0) await sleep(this.options.pollMs ?? 1000);
        }
        emit(stream.closeAll());
        if (isFinished(stream.snapshot())) emit(textMessage(ids(), summaryLine(stream.snapshot())));
        emit([{ type: EventType.RUN_FINISHED, threadId, runId, result: stream.snapshot() } as BaseEvent]);
      };
      work()
        .then(() => subscriber.complete())
        .catch((error: unknown) => {
          subscriber.next({ type: EventType.RUN_ERROR, message: error instanceof Error ? error.message : String(error) } as BaseEvent);
          subscriber.complete();
        });
      return () => {
        cancelled = true;
      };
    });
  }
}
