import type { LiveCommand, LiveConnection, LiveEvent, VoiceHost, VoiceOffer } from "@chef/core";
import type { Connect, SocketLike } from "./gpt-live.ts";

export const REALTIME_MODEL = "gpt-realtime";
export const REQUEST_TOOL = "chef_request";

export interface RealtimeOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly connect: Connect;
  readonly model?: string;
  readonly voice?: string;
  readonly fetchImpl?: typeof fetch;
}

const TOOL_RULE = `To delegate to the client, call the ${REQUEST_TOOL} tool with the user's request in their own words, then speak the result it returns.`;

export function realtimeSession(options: { readonly model?: string; readonly voice?: string; readonly instructions: string }): Record<string, unknown> {
  return {
    type: "realtime",
    model: options.model ?? REALTIME_MODEL,
    instructions: `${options.instructions}\n\n${TOOL_RULE}`,
    output_modalities: ["audio"],
    audio: { output: { voice: options.voice ?? "marin" } },
    tools: [
      {
        type: "function",
        name: REQUEST_TOOL,
        description: "Hand a request to build, change or fix something, or a question about the project, to chef. Returns what chef did.",
        parameters: { type: "object", properties: { request: { type: "string", description: "The user's request, in their words." } }, required: ["request"] },
      },
    ],
    tool_choice: "auto",
  };
}

export function endpoint(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  return `${url.origin}${`${url.pathname}/${path}`.replace(/\/{2,}/g, "/")}`;
}

function wsUrl(baseUrl: string, path: string): string {
  return endpoint(baseUrl, path).replace(/^http/, "ws");
}

function text(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}

function requestOf(args: unknown): string {
  try {
    const parsed = JSON.parse(String(args)) as { request?: unknown };
    return typeof parsed.request === "string" ? parsed.request : "";
  } catch {
    return "";
  }
}

export function liveEvents(event: LiveEvent): LiveEvent[] {
  switch (event.type) {
    case "session.created":
      return [{ type: "session.started", session: { id: (event["session"] as { id?: unknown } | undefined)?.id ?? null } }];
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta":
      return [{ type: "session.output_transcript.delta", delta: event["delta"] }];
    case "response.function_call_arguments.done":
      if (event["name"] !== REQUEST_TOOL || typeof event["call_id"] !== "string") return [];
      return [
        { type: "session.input_transcript.delta", delta: requestOf(event["arguments"]), start_ms: null },
        { type: "session.delegation.created", delegation: { id: event["call_id"], target: "client" }, offset_ms: null },
      ];
    case "error":
      return [event];
    default:
      return [];
  }
}

export function bridge(socket: SocketLike, instructions: string, onEvent: (event: LiveEvent) => void): LiveConnection {
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => (finish = resolve));
  let extra = "";
  socket.addEventListener("message", (message) => {
    let event: LiveEvent;
    try {
      event = JSON.parse(text(message.data)) as LiveEvent;
    } catch {
      onEvent({ type: "error", error: { message: "unparseable event from the Realtime API" } });
      return;
    }
    if (event && typeof event.type === "string") for (const live of liveEvents(event)) onEvent(live);
  });
  const ended = () => {
    onEvent({ type: "session.closed" });
    finish();
  };
  socket.addEventListener("close", ended);
  socket.addEventListener("error", ended);
  const send = (event: Record<string, unknown>) => socket.send(JSON.stringify(event));
  return {
    send: (command: LiveCommand) => {
      if (command.type === "session.commentary.append") {
        send({ type: "conversation.item.create", event_id: command.event_id, item: { type: "function_call_output", call_id: command.delegation_id, output: JSON.stringify({ result: command.content }) } });
        send({ type: "response.create" });
      } else if (command.type === "session.instructions.append") {
        extra = `${extra}\n\n${command.content}`;
        send({ type: "session.update", event_id: command.event_id, session: { type: "realtime", instructions: `${instructions}\n\n${TOOL_RULE}${extra}` } });
      } else if (command.type === "session.close") {
        socket.close(1000, "done");
      }
    },
    close: async () => {
      socket.close(1000, "done");
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([finished, new Promise((resolve) => (timer = setTimeout(resolve, 5_000)))]);
      clearTimeout(timer);
    },
  };
}

function callId(location: string | null): string {
  if (!location) return "";
  const url = new URL(location, "http://call.invalid");
  return url.searchParams.get("call_id") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "";
}

export class RealtimeHost implements VoiceHost {
  readonly model: string;
  private readonly instructions = new Map<string, string>();

  constructor(private readonly options: RealtimeOptions) {
    this.model = options.model ?? REALTIME_MODEL;
  }

  async open(offer: VoiceOffer): Promise<{ sessionId: string; sdp: string }> {
    const session = realtimeSession({ model: this.model, instructions: offer.instructions, ...(this.options.voice ? { voice: this.options.voice } : {}) });
    const response = await (this.options.fetchImpl ?? fetch)(endpoint(this.options.baseUrl, "/realtime/calls"), {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ sdp: offer.sdp, session }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Realtime call failed: ${response.status} ${body.slice(0, 500)}`);
    const sdp = (response.headers.get("content-type") ?? "").includes("json") ? ((JSON.parse(body) as { sdp?: string }).sdp ?? "") : body;
    const id = callId(response.headers.get("location"));
    if (!id || !sdp) throw new Error("Realtime call response has no call id or SDP answer");
    this.instructions.set(id, offer.instructions);
    return { sessionId: id, sdp };
  }

  async attach(sessionId: string, onEvent: (event: LiveEvent) => void): Promise<LiveConnection> {
    const socket = await this.options.connect(wsUrl(this.options.baseUrl, `/realtime?call_id=${encodeURIComponent(sessionId)}`), { authorization: `Bearer ${this.options.apiKey}` });
    const instructions = this.instructions.get(sessionId) ?? "";
    this.instructions.delete(sessionId);
    return bridge(socket, instructions, onEvent);
  }
}

export async function startRealtimeSession(options: RealtimeOptions & { readonly instructions: string; readonly onEvent: (event: LiveEvent) => void; readonly timeoutMs?: number }): Promise<{ readonly connection: LiveConnection; say(text: string): void }> {
  const model = options.model ?? REALTIME_MODEL;
  const socket = await options.connect(wsUrl(options.baseUrl, `/realtime?model=${encodeURIComponent(model)}`), { authorization: `Bearer ${options.apiKey}` });
  let started: () => void = () => {};
  let failed: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    started = resolve;
    failed = reject;
  });
  const connection = bridge(socket, options.instructions, (event) => {
    if (event.type === "session.started") started();
    if (event.type === "error") failed(new Error(`Realtime error: ${JSON.stringify(event["error"] ?? event)}`));
    if (event.type === "session.closed") failed(new Error("the Realtime API closed before the session started"));
    options.onEvent(event);
  });
  socket.send(JSON.stringify({ type: "session.update", session: realtimeSession({ model, instructions: options.instructions, ...(options.voice ? { voice: options.voice } : {}) }) }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("the Realtime API did not start in time")), options.timeoutMs ?? 20_000)));
  await Promise.race([ready, timeout]).finally(() => clearTimeout(timer));
  return {
    connection,
    say: (said: string) => {
      socket.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: said }] } }));
      socket.send(JSON.stringify({ type: "response.create" }));
    },
  };
}
