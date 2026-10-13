import { describe, expect, it } from "vitest";
import { endpoint, RealtimeHost, REQUEST_TOOL, startRealtimeSession } from "../../src/realtime.ts";
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
  it("opens a WebRTC call with the request tool and turns its tool call into a client delegation", async () => {
    const requests: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: new Headers(init?.headers).get("authorization") });
      return new Response("answer-sdp", { status: 201, headers: { "content-type": "application/sdp", location: "/v1/realtime/calls/rtc_123" } });
    }) as typeof fetch;
    const socket = new FakeSocket();
    const connects: string[] = [];
    const host = new RealtimeHost({ baseUrl: "https://gateway.example/v1", apiKey: "app-key", fetchImpl, connect: async (url) => (connects.push(url), socket) });

    expect(await host.open({ sdp: "offer-sdp", instructions: "be brief" })).toEqual({ sessionId: "rtc_123", sdp: "answer-sdp" });
    expect(requests[0]?.url).toBe("https://gateway.example/v1/realtime/calls");
    expect(requests[0]?.auth).toBe("Bearer app-key");
    const session = requests[0]?.body["session"] as { model: string; tools: { name: string }[]; instructions: string };
    expect(session.model).toBe("gpt-realtime");
    expect(session.tools.map((t) => t.name)).toEqual([REQUEST_TOOL]);
    expect(session.instructions.startsWith("be brief")).toBe(true);

    const events: Record<string, unknown>[] = [];
    const live = await host.attach("rtc_123", (event) => events.push(event));
    expect(connects).toEqual(["wss://gateway.example/v1/realtime?call_id=rtc_123"]);
    socket.receive({ type: "response.output_audio_transcript.delta", delta: "On it." });
    socket.receive({ type: "response.function_call_arguments.done", name: REQUEST_TOOL, call_id: "call_1", arguments: JSON.stringify({ request: "Add an item to a to-do list" }) });
    socket.receive({ type: "response.done" });
    expect(events).toEqual([
      { type: "session.output_transcript.delta", delta: "On it." },
      { type: "session.input_transcript.delta", delta: "Add an item to a to-do list", start_ms: null },
      { type: "session.delegation.created", delegation: { id: "call_1", target: "client" }, offset_ms: null },
    ]);

    live.send({ type: "session.commentary.append", event_id: "e1", delegation_id: "call_1", content: "Started todo-add." });
    expect(socket.sent).toEqual([
      { type: "conversation.item.create", event_id: "e1", item: { type: "function_call_output", call_id: "call_1", output: JSON.stringify({ result: "Started todo-add." }) } },
      { type: "response.create" },
    ]);
    await live.close();
    expect(socket.closedWith).toBe(1000);
    expect(events.at(-1)).toEqual({ type: "session.closed" });
  });

  it("starts a server-side session and sends a typed request", async () => {
    const socket = new FakeSocket((message, s) => {
      if (message["type"] === "session.update") s.receive({ type: "session.created", session: { id: "sess_9" } });
    });
    const urls: string[] = [];
    const session = await startRealtimeSession({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", instructions: "hi", onEvent: () => {}, connect: async (url) => (urls.push(url), socket) });
    expect(urls).toEqual(["ws://127.0.0.1:1/v1/realtime?model=gpt-realtime"]);
    session.say("Add an item");
    expect(socket.sent.map((m) => m["type"])).toEqual(["session.update", "conversation.item.create", "response.create"]);
  });
});

describe("realtime endpoints", () => {
  it("joins a base URL with a trailing slash or a doubled slash into one clean path", () => {
    expect(endpoint("https://gateway.example//v1", "/realtime/calls")).toBe("https://gateway.example/v1/realtime/calls");
    expect(endpoint("https://gateway.example/v1/", "/realtime?model=gpt-realtime")).toBe("https://gateway.example/v1/realtime?model=gpt-realtime");
    expect(endpoint("https://api.openai.com/v1", "/realtime?call_id=c1")).toBe("https://api.openai.com/v1/realtime?call_id=c1");
  });
});
