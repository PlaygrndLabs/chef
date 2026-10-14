import type { SubmitResult } from "../orchestrator/orchestrator.ts";
import type { IdSource } from "../ports/runtime.ts";
import type { LiveCommand, LiveConnection, LiveEvent, VoiceHost } from "../ports/voice.ts";
import type { FeatureSpec } from "../spec/schema.ts";
import { SpokenTurns, type SpokenTurn } from "./turns.ts";

export interface SpokenTarget {
  submitSpoken(prompt: string, call: { readonly voiceSessionId: string; readonly delegationId: string }): Promise<SubmitResult>;
  recordSpoken?(turn: SpokenTurn & { readonly voiceSessionId: string }): Promise<void>;
}

interface Heard {
  readonly text: string;
  readonly start: number | null;
}

export function voiceInstructions(spec: readonly FeatureSpec[]): string {
  const features = spec.length ? spec.map((f) => `- ${f.id}: ${f.title} (${f.status})`).join("\n") : "- none yet";
  return [
    "You are the voice of chef, a builder that turns spoken requests into merged software features with no human steps.",
    "Delegate to the client for every request to build, change or fix something, and for every question about the project. Never claim work is done unless the client said so.",
    "While you wait, say briefly that you are on it. Speak the client's commentary in the language the user speaks, in one or two short sentences.",
    `Features in this project:\n${features}`,
  ].join("\n\n");
}

export function spokenReply(result: SubmitResult): string {
  if (result.answer) return result.answer.text;
  const feature = result.featureId ?? result.decision.featureId ?? "the feature";
  if (!result.sessionId) return `Nothing to build for that request (${result.decision.reason}).`;
  const kind = result.decision.intent === "new_feature" ? "a new feature" : result.decision.intent === "chore" ? "a chore" : `a ${result.decision.changeKind ?? "change"} to an existing feature`;
  const attempts = result.sessionIds.length > 1 ? ` with ${result.sessionIds.length} parallel attempts` : "";
  const lane = result.decision.hotfix ? " as a hotfix, ahead of other builds" : "";
  return `Started ${kind}, ${feature}${attempts}${lane}. It merges on its own once tests, review and proof pass; the dashboard shows its preview.`;
}

export class VoiceDelegate {
  private heard: Heard[] = [];
  private pending: Promise<void> = Promise.resolve();
  readonly requests: { readonly delegationId: string; readonly prompt: string; readonly result: SubmitResult | null }[] = [];

  constructor(
    private readonly voiceSessionId: string,
    private readonly target: SpokenTarget,
    private readonly send: (command: LiveCommand) => void,
    private readonly ids: IdSource,
    private readonly settle: () => Promise<void> = async () => {},
  ) {}

  handle(event: LiveEvent): Promise<void> {
    if (event.type === "session.input_transcript.delta" && typeof event["delta"] === "string") {
      this.heard.push({ text: event["delta"], start: typeof event["start_ms"] === "number" ? event["start_ms"] : null });
      return this.pending;
    }
    if (event.type !== "session.delegation.created") return this.pending;
    const delegation = event["delegation"] as { id?: unknown; target?: unknown; request?: unknown } | undefined;
    if (typeof delegation?.id !== "string" || delegation.target !== "client") return this.pending;
    const offset = typeof event["offset_ms"] === "number" ? event["offset_ms"] : null;
    const id = delegation.id;
    const request = typeof delegation.request === "string" ? delegation.request.trim() : "";
    this.pending = this.pending.then(() => this.delegate(id, offset, request));
    return this.pending;
  }

  private take(offset: number | null): string {
    const taken = offset === null ? this.heard : this.heard.filter((h) => h.start === null || h.start < offset);
    this.heard = this.heard.filter((h) => !taken.includes(h));
    return taken
      .map((h) => h.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  private async delegate(delegationId: string, offset: number | null, request: string): Promise<void> {
    await this.settle();
    const heard = this.take(offset);
    const prompt = request || heard;
    if (!prompt) {
      this.requests.push({ delegationId, prompt, result: null });
      this.reply(delegationId, "I did not catch a request. Please say it again.");
      return;
    }
    try {
      const result = await this.target.submitSpoken(prompt, { voiceSessionId: this.voiceSessionId, delegationId });
      this.requests.push({ delegationId, prompt, result });
      this.reply(delegationId, spokenReply(result));
    } catch (error) {
      this.requests.push({ delegationId, prompt, result: null });
      this.reply(delegationId, `That request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private reply(delegationId: string, content: string): void {
    this.send({ type: "session.commentary.append", event_id: this.ids.next("ev"), delegation_id: delegationId, content: content.slice(0, 1500) });
  }

  idle(): Promise<void> {
    return this.pending;
  }
}

export interface VoiceCall {
  readonly sessionId: string;
  readonly delegate: VoiceDelegate;
  readonly connection: LiveConnection;
  sendAudio(pcm: Uint8Array): void;
}

export async function startVoiceCall(input: { host: VoiceHost; target: SpokenTarget; spec: readonly FeatureSpec[]; ids: IdSource; settle?: () => Promise<void>; onEvent?: (event: LiveEvent) => void; now?: () => number }): Promise<VoiceCall> {
  let delegate: VoiceDelegate | null = null;
  let turns: SpokenTurns | null = null;
  const early: LiveEvent[] = [];
  const handle = (event: LiveEvent) => {
    input.onEvent?.(event);
    if (!delegate) {
      early.push(event);
      return;
    }
    turns?.handle(event);
    void delegate.handle(event);
  };
  const stream = await input.host.start({ instructions: voiceInstructions(input.spec), onEvent: handle });
  const record = input.target.recordSpoken?.bind(input.target);
  turns = record ? new SpokenTurns((turn) => void record({ ...turn, voiceSessionId: stream.sessionId }).catch(() => {}), input.now) : null;
  delegate = new VoiceDelegate(stream.sessionId, input.target, (command) => stream.connection.send(command), input.ids, input.settle);
  for (const event of early.splice(0)) {
    turns?.handle(event);
    void delegate.handle(event);
  }
  return { sessionId: stream.sessionId, delegate, connection: stream.connection, sendAudio: (pcm) => stream.sendAudio(pcm) };
}
