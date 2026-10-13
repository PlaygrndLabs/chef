import type { LiveCommand, LiveConnection, LiveEvent, VoiceHost, VoiceOffer } from "../ports/voice.ts";

export function spokenEvents(text: string, delegationId: string, startMs: number): LiveEvent[] {
  const events: LiveEvent[] = [];
  let at = startMs;
  for (const word of text.split(/(?<=\s)/)) {
    events.push({ type: "session.input_transcript.delta", delta: word, start_ms: at, end_ms: at + 300 });
    at += 300;
  }
  events.push({ type: "session.delegation.created", event_id: `ev-${delegationId}`, offset_ms: at + 200, delegation: { id: delegationId, type: "delegation", target: "client" } });
  return events;
}

export class ScriptedVoiceHost implements VoiceHost {
  readonly model = "scripted-voice";
  readonly offers: VoiceOffer[] = [];
  readonly commands: LiveCommand[] = [];
  private listener: ((event: LiveEvent) => void) | null = null;
  private clock = 0;
  private count = 0;

  async open(offer: VoiceOffer): Promise<{ sessionId: string; sdp: string }> {
    this.offers.push(offer);
    return { sessionId: `voice${this.offers.length}`, sdp: `answer for ${offer.sdp}` };
  }

  async attach(sessionId: string, onEvent: (event: LiveEvent) => void): Promise<LiveConnection> {
    this.listener = onEvent;
    onEvent({ type: "session.started", session: { id: sessionId } });
    return {
      send: (command) => {
        this.commands.push(command);
      },
      close: async () => {
        this.listener = null;
      },
    };
  }

  say(text: string): string {
    const listener = this.listener;
    if (!listener) throw new Error("no attached voice session");
    const id = `del${++this.count}`;
    const events = spokenEvents(text, id, this.clock);
    this.clock += 10_000;
    for (const event of events) listener(event);
    return id;
  }

  hangUp(): void {
    this.listener?.({ type: "session.closed" });
  }

  spoken(): string[] {
    return this.commands.flatMap((c) => (c.type === "session.commentary.append" ? [c.content] : []));
  }
}
