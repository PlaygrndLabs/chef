import type { SubmitResult } from "../orchestrator/orchestrator.ts";
import type { IdSource } from "../ports/runtime.ts";
import type { LiveCommand, LiveConnection, LiveEvent, VoiceHost } from "../ports/voice.ts";
import type { FeatureSpec } from "../spec/schema.ts";

export interface SpokenTarget {
  submitSpoken(prompt: string, call: { readonly voiceSessionId: string; readonly delegationId: string }): Promise<SubmitResult>;
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
    const delegation = event["delegation"] as { id?: unknown; target?: unknown } | undefined;
    if (typeof delegation?.id !== "string" || delegation.target !== "client") return this.pending;
    const offset = typeof event["offset_ms"] === "number" ? event["offset_ms"] : null;
    const id = delegation.id;
    this.pending = this.pending.then(() => this.delegate(id, offset));
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

  private async delegate(delegationId: string, offset: number | null): Promise<void> {
    await this.settle();
    const prompt = this.take(offset);
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
  readonly sdp: string;
  readonly delegate: VoiceDelegate;
  readonly connection: LiveConnection;
}

export async function startVoiceCall(input: { host: VoiceHost; target: SpokenTarget; spec: readonly FeatureSpec[]; sdp: string; ids: IdSource; settle?: () => Promise<void>; onEvent?: (event: LiveEvent) => void }): Promise<VoiceCall> {
  const { sessionId, sdp } = await input.host.open({ sdp: input.sdp, instructions: voiceInstructions(input.spec) });
  let connection: LiveConnection | null = null;
  const queued: LiveCommand[] = [];
  const delegate = new VoiceDelegate(sessionId, input.target, (command) => (connection ? connection.send(command) : queued.push(command)), input.ids, input.settle);
  connection = await input.host.attach(sessionId, (event) => {
    input.onEvent?.(event);
    void delegate.handle(event);
  });
  for (const command of queued.splice(0)) connection.send(command);
  return { sessionId, sdp, delegate, connection };
}
