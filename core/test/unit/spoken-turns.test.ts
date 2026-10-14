import { describe, expect, it } from "vitest";
import { SpokenTurns, type SpokenTurn } from "../../src/voice/turns.ts";

describe("spoken turns", () => {
  it("joins deltas into one turn per speaker and closes a turn when the other speaker starts after a pause", () => {
    let now = 0;
    const turns: SpokenTurn[] = [];
    const spoken = new SpokenTurns((turn) => turns.push(turn), () => now);
    spoken.handle({ type: "session.input_transcript.delta", delta: "Add a " });
    now = 200;
    spoken.handle({ type: "session.input_transcript.delta", delta: "todo   list" });
    now = 1000;
    spoken.handle({ type: "session.output_transcript.delta", delta: "On it." });
    now = 1100;
    spoken.handle({ type: "session.output_audio.delta", delta: "AAAA" });
    expect(turns).toEqual([{ speaker: "you", text: "Add a todo list", startedAt: 0 }]);
    spoken.handle({ type: "session.closed" });
    expect(turns[1]).toEqual({ speaker: "chef", text: "On it.", startedAt: 1000 });
  });

  it("keeps a turn open while both speakers overlap, and closes it on a done event", () => {
    let now = 0;
    const turns: SpokenTurn[] = [];
    const spoken = new SpokenTurns((turn) => turns.push(turn), () => now);
    spoken.handle({ type: "session.output_transcript.delta", delta: "Sure, " });
    now = 100;
    spoken.handle({ type: "session.input_transcript.delta", delta: "wait" });
    now = 200;
    spoken.handle({ type: "session.output_transcript.delta", delta: "go on." });
    expect(turns).toEqual([]);
    spoken.handle({ type: "response.output_audio_transcript.done" });
    expect(turns).toEqual([{ speaker: "chef", text: "Sure, go on.", startedAt: 0 }]);
    spoken.handle({ type: "conversation.item.input_audio_transcription.completed" });
    expect(turns[1]).toEqual({ speaker: "you", text: "wait", startedAt: 100 });
  });

  it("ends your turn at a delegation, keeping words said before its offset that arrive late", () => {
    let now = 0;
    const turns: SpokenTurn[] = [];
    const spoken = new SpokenTurns((turn) => turns.push(turn), () => now);
    spoken.handle({ type: "session.input_transcript.delta", delta: "Add a ", start_ms: 0 });
    spoken.handle({ type: "session.delegation.created", offset_ms: 900, delegation: { id: "d1", target: "client" } });
    now = 300;
    spoken.handle({ type: "session.input_transcript.delta", delta: "page", start_ms: 500 });
    now = 5000;
    spoken.handle({ type: "session.input_transcript.delta", delta: "Thanks", start_ms: 5000 });
    expect(turns).toEqual([{ speaker: "you", text: "Add a page", startedAt: 0 }]);
  });

  it("records your words from a final transcript that arrives after Chef started answering, dated when you started speaking", () => {
    let now = 0;
    const turns: SpokenTurn[] = [];
    const spoken = new SpokenTurns((turn) => turns.push(turn), () => now);
    spoken.handle({ type: "session.input_speech.started" });
    now = 900;
    spoken.handle({ type: "session.output_transcript.delta", delta: "Got it." });
    now = 1200;
    spoken.handle({ type: "session.input_transcript.done", item_id: "item_1", transcript: " Add  a todo list " });
    spoken.handle({ type: "session.output_transcript.done" });
    expect(turns).toEqual([
      { speaker: "you", text: "Add a todo list", startedAt: 0 },
      { speaker: "chef", text: "Got it.", startedAt: 900 },
    ]);
  });

  it("does not record your words twice when deltas came before the final transcript", () => {
    let now = 0;
    const turns: SpokenTurn[] = [];
    const spoken = new SpokenTurns((turn) => turns.push(turn), () => now);
    spoken.handle({ type: "session.input_speech.started" });
    now = 300;
    spoken.handle({ type: "session.input_transcript.delta", item_id: "item_1", delta: "Hello" });
    spoken.handle({ type: "session.input_transcript.done", item_id: "item_1", transcript: "Hello" });
    spoken.handle({ type: "session.closed" });
    expect(turns).toEqual([{ speaker: "you", text: "Hello", startedAt: 0 }]);
  });
});
