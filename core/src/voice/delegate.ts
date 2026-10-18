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

export function voiceInstructions(spec: readonly FeatureSpec[], context = ""): string {
  const features = spec.length ? spec.map((f) => `- ${f.id}: ${f.title} (${f.status})`).join("\n") : "- none yet";
  return [
    "You are Chef, the builder of this project, talking with the person live by voice. You are the same Chef they type to in the project's chat: that chat is your own conversation with them, and what gets built, answered and remembered there is your own work. Speak in the first person, as in \"I'll add that\" or \"Let me check\". Never talk about Chef, a builder, a client, a tool or an assistant as someone else, and never say you are passing, forwarding or handing a request on.",
    "Act on every request to build, add, change or fix something, and on every question about the project, right away and in the person's own words: delegating to the client is how you yourself build and look things up. Never ask for details first: you work them out while you build. Never claim work is done unless the result says so.",
    "While you work, say in a few words that you are on it. Then say the result as your own, in one or two short sentences, in the language of the person's last words; when unsure, in English. Persian (Farsi) is not Arabic: answer Persian in Persian.",
    `Features in this project:\n${features}`,
    context,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function spokenReply(result: SubmitResult): string {
  if (result.answer) return result.answer.text;
  const feature = result.featureId ?? result.decision.featureId ?? "the feature";
  if (!result.sessionId) return `There is nothing for me to build for that (${result.decision.reason}).`;
  const kind = result.decision.intent === "new_feature" ? "a new feature" : result.decision.intent === "chore" ? "a chore" : `a ${result.decision.changeKind ?? "change"} to an existing feature`;
  const attempts = result.sessionIds.length > 1 ? ` with ${result.sessionIds.length} parallel attempts` : "";
  const lane = result.decision.hotfix ? " as a hotfix, ahead of other builds" : "";
  return `I started ${kind}, ${feature}${attempts}${lane}. I merge it on my own once its tests, review and proof pass; the chat shows its running app.`;
}

export class VoiceDelegate {
  private heard: Heard[] = [];
  private readonly heardItems = new Set<string>();
  private pending: Promise<void> = Promise.resolve();
  private ended = false;
  readonly requests: { readonly delegationId: string; readonly prompt: string; readonly result: SubmitResult | null }[] = [];

  constructor(
    private readonly voiceSessionId: string,
    private readonly target: SpokenTarget,
    private readonly send: (command: LiveCommand) => void,
    private readonly ids: IdSource,
    private readonly settle: () => Promise<void> = async () => {},
    private readonly unspoken: (content: string) => void = () => {},
  ) {}

  handle(event: LiveEvent): Promise<void> {
    const item = typeof event["item_id"] === "string" ? event["item_id"] : null;
    if (event.type === "session.input_transcript.delta" && typeof event["delta"] === "string") {
      if (item) this.heardItems.add(item);
      this.heard.push({ text: event["delta"], start: typeof event["start_ms"] === "number" ? event["start_ms"] : null });
      return this.pending;
    }
    if (event.type === "session.input_transcript.done" && typeof event["transcript"] === "string") {
      if (item && !this.heardItems.has(item)) this.heard.push({ text: ` ${event["transcript"]}`, start: null });
      if (item) this.heardItems.add(item);
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
      this.reply(delegationId, `I could not do that: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private reply(delegationId: string, content: string): void {
    if (this.ended) {
      this.unspoken(content);
      return;
    }
    try {
      this.send({ type: "session.commentary.append", event_id: this.ids.next("ev"), delegation_id: delegationId, content: content.slice(0, 1500) });
    } catch {
      this.unspoken(content);
    }
  }

  idle(): Promise<void> {
    return this.pending;
  }

  end(): Promise<void> {
    this.ended = true;
    return this.pending;
  }
}

export interface VoiceCall {
  readonly sessionId: string;
  readonly delegate: VoiceDelegate;
  readonly connection: LiveConnection;
  sendAudio(pcm: Uint8Array): void;
  hangUp(): Promise<void>;
}

export async function startVoiceCall(input: { host: VoiceHost; target: SpokenTarget; spec: readonly FeatureSpec[]; context?: string; ids: IdSource; settle?: () => Promise<void>; onEvent?: (event: LiveEvent) => void; now?: () => number }): Promise<VoiceCall> {
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
  const stream = await input.host.start({ instructions: voiceInstructions(input.spec, input.context), onEvent: handle });
  const record = input.target.recordSpoken?.bind(input.target);
  const saving = new Set<Promise<void>>();
  const save = (turn: SpokenTurn) => {
    if (!record) return;
    const saved = record({ ...turn, voiceSessionId: stream.sessionId })
      .catch(() => {})
      .finally(() => saving.delete(saved));
    saving.add(saved);
  };
  turns = record ? new SpokenTurns(save, input.now) : null;
  const now = input.now ?? Date.now;
  const unspoken = (text: string) => save({ speaker: "chef", text, startedAt: now() });
  const voice = new VoiceDelegate(stream.sessionId, input.target, (command) => stream.connection.send(command), input.ids, input.settle, unspoken);
  delegate = voice;
  for (const event of early.splice(0)) {
    turns?.handle(event);
    void delegate.handle(event);
  }
  const hangUp = async () => {
    const working = voice.end();
    await stream.connection.close();
    turns?.endAll();
    await working;
    await Promise.all([...saving]);
  };
  return { sessionId: stream.sessionId, delegate: voice, connection: stream.connection, sendAudio: (pcm) => stream.sendAudio(pcm), hangUp };
}
