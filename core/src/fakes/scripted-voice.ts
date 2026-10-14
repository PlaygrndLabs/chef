import type { LiveCommand, LiveEvent, VoiceHost, VoiceStream } from "../ports/voice.ts";

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
  readonly instructions: string[] = [];
  readonly commands: LiveCommand[] = [];
  readonly audio: Uint8Array[] = [];
  private listener: ((event: LiveEvent) => void) | null = null;
  private clock = 0;
  private count = 0;

  async start(input: { readonly instructions: string; readonly onEvent: (event: LiveEvent) => void }): Promise<VoiceStream> {
    this.instructions.push(input.instructions);
    const sessionId = `voice${this.instructions.length}`;
    this.listener = input.onEvent;
    input.onEvent({ type: "session.started", session: { id: sessionId } });
    return {
      sessionId,
      connection: {
        send: (command) => {
          this.commands.push(command);
        },
        close: async () => {
          this.listener?.({ type: "session.closed" });
          this.listener = null;
        },
      },
      sendAudio: (pcm) => {
        this.audio.push(pcm);
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
