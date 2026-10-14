import type { LiveEvent } from "../ports/voice.ts";

export type Speaker = "you" | "chef";

export interface SpokenTurn {
  readonly speaker: Speaker;
  readonly text: string;
  readonly startedAt: number;
}

interface Open {
  text: string;
  readonly startedAt: number;
  lastAt: number;
}

const QUIET_MS = 500;
const SETTLE_MS = 800;

export function speakerOf(type: string): Speaker | null {
  if (type === "session.input_transcript.delta" || type === "conversation.item.input_audio_transcription.delta") return "you";
  if (type === "session.output_transcript.delta" || type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") return "chef";
  return null;
}

function finishedSpeaker(type: string): Speaker | null {
  if (!/transcript(ion)?\.(done|completed)$/.test(type)) return null;
  return /input/.test(type) ? "you" : "chef";
}

export class SpokenTurns {
  private readonly open = new Map<Speaker, Open>();
  private cut: { readonly offset: number | null; readonly at: number } | null = null;
  private readonly heardItems = new Set<string>();
  private speechAt: number | null = null;

  constructor(
    private readonly flush: (turn: SpokenTurn) => void,
    private readonly now: () => number = Date.now,
  ) {}

  handle(event: LiveEvent): void {
    const speaker = speakerOf(event.type);
    if (event.type === "session.input_speech.started") {
      if (!this.open.has("you")) this.speechAt ??= this.now();
      return;
    }
    if (speaker && typeof event["delta"] === "string") {
      const at = this.now();
      if (speaker === "you" && typeof event["item_id"] === "string") this.heardItems.add(event["item_id"]);
      const other: Speaker = speaker === "you" ? "chef" : "you";
      const waiting = this.open.get(other);
      if (waiting && at - waiting.lastAt >= QUIET_MS) this.end(other);
      if (speaker === "you" && this.cut && !this.before(this.cut, event, at)) this.end("you");
      const current = this.open.get(speaker);
      if (current) {
        current.text += event["delta"];
        current.lastAt = at;
      } else this.open.set(speaker, { text: event["delta"], startedAt: speaker === "you" ? this.spoke(at) : at, lastAt: at });
      return;
    }
    if (event.type === "session.delegation.created" && this.open.has("you")) this.cut = { offset: typeof event["offset_ms"] === "number" ? event["offset_ms"] : null, at: this.now() };
    const finished = finishedSpeaker(event.type);
    const item = event["item_id"];
    if (finished === "you" && typeof item === "string" && !this.heardItems.has(item) && typeof event["transcript"] === "string") {
      this.heardItems.add(item);
      this.end("you");
      const text = event["transcript"].replace(/\s+/g, " ").trim();
      if (text) this.flush({ speaker: "you", text, startedAt: this.spoke(this.now()) });
    } else if (finished) this.end(finished);
    if (event.type === "session.closed") this.endAll();
  }

  endAll(): void {
    const order = [...this.open.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
    for (const [speaker] of order) this.end(speaker);
  }

  private spoke(at: number): number {
    const start = this.speechAt ?? at;
    this.speechAt = null;
    return start;
  }

  private before(cut: { readonly offset: number | null; readonly at: number }, event: LiveEvent, at: number): boolean {
    const start = event["start_ms"];
    if (typeof start === "number" && cut.offset !== null) return start < cut.offset;
    return at - cut.at < SETTLE_MS;
  }

  private end(speaker: Speaker): void {
    if (speaker === "you") this.cut = null;
    const turn = this.open.get(speaker);
    this.open.delete(speaker);
    const text = turn?.text.replace(/\s+/g, " ").trim();
    if (turn && text) this.flush({ speaker, text, startedAt: turn.startedAt });
  }
}
