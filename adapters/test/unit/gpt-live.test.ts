import { describe, expect, it } from "vitest";
import { GptLiveHost, speak, startServerSession, type SocketLike } from "../../src/gpt-live.ts";

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

describe("GPT-Live adapter", () => {
  it("starts a live session for the engine, forwards caller audio and names Chef's audio in one shape", async () => {
    const socket = new FakeSocket((message, s) => {
      if (message["type"] === "session.start") s.receive({ type: "session.started", session: { id: "sess_1" } });
      if (message["type"] === "session.close") s.receive({ type: "session.closed", usage: {} });
    });
    const connects: { url: string; headers: Record<string, string> }[] = [];
    const host = new GptLiveHost({ apiKey: "sk-test", voice: "marin", connect: async (url, headers) => (connects.push({ url, headers }), socket) });
    const events: Record<string, unknown>[] = [];
    const stream = await host.start({ instructions: "be brief", onEvent: (event) => events.push(event) });
    expect(stream.sessionId).toBe("sess_1");
    expect(connects).toEqual([{ url: "wss://api.openai.com/v1/live/sessions", headers: { authorization: "Bearer sk-test" } }]);
    expect((socket.sent[0]?.["session"] as { instructions: string; delegation: unknown }).instructions).toBe("be brief");
    stream.sendAudio(new Uint8Array(4).fill(2));
    expect(socket.sent.at(-1)).toEqual({ type: "session.input_audio.append", audio: Buffer.from(new Uint8Array(4).fill(2)).toString("base64") });
    socket.receive({ type: "session.output_audio.delta", audio: "AAA=" });
    socket.receive({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    stream.connection.send({ type: "session.commentary.append", event_id: "e1", delegation_id: "d1", content: "on it" });
    await stream.connection.close();
    expect(events.map((e) => e["type"])).toEqual(["session.started", "session.output_audio.delta", "session.delegation.created", "session.closed"]);
    expect(events[1]).toEqual({ type: "session.output_audio.delta", delta: "AAA=" });
    expect(socket.sent.map((m) => m["type"]).slice(1)).toEqual(["session.input_audio.append", "session.commentary.append", "session.close"]);
  });

  it("starts a server-side audio session and sends PCM in base64 chunks", async () => {
    const socket = new FakeSocket((message, s) => {
      if (message["type"] === "session.start") s.receive({ type: "session.started", session: { id: "sess_2" } });
    });
    const session = await startServerSession({ apiKey: "sk-test", instructions: "hi", connect: async () => socket, onEvent: () => {} });
    expect(session.sessionId).toBe("sess_2");
    expect(socket.sent[0]).toEqual({
      type: "session.start",
      event_id: "chef-start",
      session: { model: "gpt-live-1", instructions: "hi", audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice: "marin" } }, delegation: { type: "client" } },
    });
    session.sendAudio(new Uint8Array(20000).fill(1));
    const chunks = socket.sent.filter((m) => m["type"] === "session.input_audio.append").map((m) => Buffer.from(String(m["audio"]), "base64").length);
    expect(chunks).toEqual([9600, 9600, 800]);
  });

  it("fails fast when GPT-Live reports an error before the session starts", async () => {
    const socket = new FakeSocket((message, s) => {
      if (message["type"] === "session.start") s.receive({ type: "error", error: { message: "model not available" } });
    });
    await expect(startServerSession({ apiKey: "k", instructions: "hi", connect: async () => socket, onEvent: () => {} })).rejects.toThrow("model not available");
  });

  it("synthesizes speech as raw PCM", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }) as typeof fetch;
    expect([...(await speak({ apiKey: "k", text: "Add an item", fetchImpl }))]).toEqual([1, 2, 3, 4]);
    expect(body).toEqual({ model: "gpt-4o-mini-tts", voice: "alloy", input: "Add an item", response_format: "pcm" });
  });
});
