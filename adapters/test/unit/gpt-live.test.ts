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
  it("exchanges the browser offer with client delegation and attaches a sideband socket", async () => {
    const requests: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ session: { id: "sess_1" }, transport: { type: "webrtc", sdp: "answer-sdp" } }, { status: 201 });
    }) as typeof fetch;
    const socket = new FakeSocket((message, s) => {
      if (message["type"] === "session.close") s.receive({ type: "session.closed", usage: {} });
    });
    const connects: { url: string; headers: Record<string, string> }[] = [];
    const host = new GptLiveHost({ apiKey: "sk-test", voice: "marin", fetchImpl, connect: async (url, headers) => (connects.push({ url, headers }), socket) });

    expect(await host.open({ sdp: "offer-sdp", instructions: "be brief" })).toEqual({ sessionId: "sess_1", sdp: "answer-sdp" });
    expect(requests[0]).toEqual({
      url: "https://api.openai.com/v1/live/sessions",
      auth: "Bearer sk-test",
      body: { session: { model: "gpt-live-1", instructions: "be brief", delegation: { type: "client" }, audio: { output: { voice: "marin" } } }, transport: { type: "webrtc", sdp: "offer-sdp" } },
    });

    const events: string[] = [];
    const live = await host.attach("sess_1", (event) => events.push(event.type));
    expect(connects).toEqual([{ url: "wss://api.openai.com/v1/live/sessions/sess_1/attach", headers: { authorization: "Bearer sk-test" } }]);
    socket.receive({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    socket.emit("message", { data: "not json" });
    live.send({ type: "session.commentary.append", event_id: "e1", delegation_id: "d1", content: "on it" });
    await live.close();
    expect(events).toEqual(["session.delegation.created", "error", "session.closed"]);
    expect(socket.sent.map((m) => m["type"])).toEqual(["session.commentary.append", "session.close"]);
    expect(socket.closedWith).toBe(1000);
  });

  it("starts a server-side audio session and sends PCM in base64 chunks", async () => {
    const socket = new FakeSocket((message, s) => {
      if (message["type"] === "session.start") s.receive({ type: "session.started", session: { id: "sess_2" } });
    });
    const session = await startServerSession({ apiKey: "sk-test", instructions: "hi", connect: async () => socket, onEvent: () => {} });
    expect(session.sessionId).toBe("sess_2");
    expect(socket.sent[0]).toEqual({
      type: "session.start",
      event_id: "kargah-start",
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
