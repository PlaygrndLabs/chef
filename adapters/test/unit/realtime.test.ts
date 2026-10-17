import { describe, expect, it, vi } from "vitest";
import { endpoint, liveEvents, RealtimeHost, REQUEST_TOOL, startRealtimeSession, voiceUsage } from "../../src/realtime.ts";
import type { SocketLike } from "../../src/gpt-live.ts";

class FakeSocket implements SocketLike {
  readonly sent: Record<string, unknown>[] = [];
  private readonly listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
  closedWith: number | null = null;

  constructor(private readonly onSend: (message: Record<string, unknown>, socket: FakeSocket) => void = () => {}) {}

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(message);
    this.onSend(message, this);
  }

  close(code?: number): void {
    this.closedWith = code ?? 1000;
    this.emit("close", { data: null });
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  emit(type: string, event: { data: unknown }): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  receive(event: Record<string, unknown>): void {
    this.emit("message", { data: JSON.stringify(event) });
  }
}

describe("Realtime adapter for a custom provider", () => {
  it("starts an audio session, forwards caller audio and turns the request tool into a client delegation", async () => {
    const socket = new FakeSocket((message, s) => {
      if (message["type"] === "session.update" && !message["event_id"]) s.receive({ type: "session.created", session: { id: "sess_9" } });
    });
    const urls: string[] = [];
    const host = new RealtimeHost({ baseUrl: "https://gateway.example/v1/", apiKey: "app-key", connect: async (url, headers) => (urls.push(`${url} ${headers["authorization"]}`), socket) });
    const events: Record<string, unknown>[] = [];
    const stream = await host.start({ instructions: "be brief", onEvent: (event) => events.push(event) });
    expect(stream.sessionId).toBe("sess_9");
    expect(urls).toEqual(["wss://gateway.example/v1/realtime?model=gpt-realtime Bearer app-key"]);
    const session = socket.sent[0]?.["session"] as { tools: { name: string }[]; instructions: string; audio: { input: { format: unknown; transcription: unknown } } };
    expect(session.tools.map((t) => t.name)).toEqual([REQUEST_TOOL]);
    expect(session.instructions.startsWith("be brief")).toBe(true);
    expect(session.audio.input.format).toEqual({ type: "audio/pcm", rate: 24000 });

    stream.sendAudio(new Uint8Array(30000).fill(1));
    const chunks = socket.sent.filter((m) => m["type"] === "input_audio_buffer.append").map((m) => Buffer.from(String(m["audio"]), "base64").length);
    expect(chunks).toEqual([24000, 6000]);

    socket.receive({ type: "input_audio_buffer.speech_started" });
    socket.receive({ type: "conversation.item.input_audio_transcription.delta", item_id: "item_1", delta: "uh add a to-do list" });
    socket.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "uh add a to-do list" });
    socket.receive({ type: "conversation.item.input_audio_transcription.failed", item_id: "item_2", error: { message: "no audio" } });
    socket.receive({ type: "response.output_audio.delta", delta: "AAA=" });
    socket.receive({ type: "response.output_audio_transcript.delta", delta: "On it." });
    socket.receive({ type: "response.output_audio_transcript.done", transcript: "On it." });
    socket.receive({ type: "response.function_call_arguments.done", name: REQUEST_TOOL, call_id: "call_1", arguments: JSON.stringify({ request: "Add a to-do list" }) });
    socket.receive({ type: "response.done" });
    expect(events.slice(1)).toEqual([
      { type: "session.input_speech.started" },
      { type: "session.input_transcript.delta", delta: "uh add a to-do list", item_id: "item_1", start_ms: null },
      { type: "session.input_transcript.done", transcript: "uh add a to-do list", item_id: "item_1" },
      { type: "error", error: { message: 'transcribing what the user said failed: {"message":"no audio"}' } },
      { type: "session.output_audio.delta", delta: "AAA=" },
      { type: "session.output_transcript.delta", delta: "On it." },
      { type: "session.output_transcript.done" },
      { type: "session.delegation.created", delegation: { id: "call_1", target: "client", request: "Add a to-do list" }, offset_ms: null },
    ]);

    const sent = socket.sent.length;
    stream.connection.send({ type: "session.commentary.append", event_id: "e1", delegation_id: "call_1", content: "Started todo-add." });
    expect(socket.sent.slice(sent)).toEqual([
      { type: "conversation.item.create", event_id: "e1", item: { type: "function_call_output", call_id: "call_1", output: JSON.stringify({ result: "Started todo-add." }) } },
      { type: "response.create" },
    ]);
    await stream.connection.close();
    expect(socket.closedWith).toBe(1000);
    expect(events.at(-1)).toEqual({ type: "session.closed" });
  });

  it("fails fast when the provider reports an error before the session starts", async () => {
    const socket = new FakeSocket((message, s) => {
      if (message["type"] === "session.update") s.receive({ type: "error", error: { message: "no realtime here" } });
    });
    await expect(startRealtimeSession({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", instructions: "hi", onEvent: () => {}, connect: async () => socket })).rejects.toThrow("no realtime here");
  });
});

describe("closing a Realtime call", () => {
  it("reports the call closed even when the provider never confirms the close", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket((message, s) => {
        if (message["type"] === "session.update" && !message["event_id"]) s.receive({ type: "session.created", session: { id: "sess_2" } });
      });
      socket.close = (code?: number) => {
        socket.closedWith = code ?? 1000;
      };
      const events: Record<string, unknown>[] = [];
      const stream = await startRealtimeSession({ baseUrl: "https://gateway.example/v1", apiKey: "k", instructions: "hi", onEvent: (event) => events.push(event), connect: async () => socket });
      const closing = stream.connection.close();
      await vi.advanceTimersByTimeAsync(5_000);
      await closing;
      expect(events.filter((e) => e["type"] === "session.closed")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("realtime endpoints", () => {
  it("joins a base URL with a trailing slash or a doubled slash into one clean path", () => {
    expect(endpoint("https://gateway.example//v1", "/realtime/calls")).toBe("https://gateway.example/v1/realtime/calls");
    expect(endpoint("https://gateway.example/v1/", "/realtime?model=gpt-realtime")).toBe("https://gateway.example/v1/realtime?model=gpt-realtime");
    expect(endpoint("https://api.openai.com/v1", "/realtime?call_id=c1")).toBe("https://api.openai.com/v1/realtime?call_id=c1");
  });
});

describe("voice usage", () => {
  it("reads token usage from a finished Realtime response and from a closed GPT Live session", () => {
    const usage = { input_tokens: 120, output_tokens: 80, input_token_details: { audio_tokens: 100, cached_tokens: 10 }, output_token_details: { audio_tokens: 70 } };
    const [event] = liveEvents({ type: "response.done", response: { usage } });
    expect(event).toEqual({ type: "session.usage", usage });
    expect(voiceUsage(event as never)).toEqual({ inputTokens: 120, outputTokens: 80, cachedInputTokens: 10, audioInputTokens: 100, audioOutputTokens: 70 });
    expect(voiceUsage({ type: "session.closed", usage: { input_tokens: 5, output_tokens: 1 } })).toEqual({ inputTokens: 5, outputTokens: 1, cachedInputTokens: 0, audioInputTokens: 0, audioOutputTokens: 0 });
    expect(voiceUsage({ type: "session.closed", usage: {} })).toBeNull();
    expect(voiceUsage({ type: "session.closed" })).toBeNull();
    expect(liveEvents({ type: "response.done", response: {} })).toEqual([]);
  });
});
