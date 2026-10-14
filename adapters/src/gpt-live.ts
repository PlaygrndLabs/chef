import type { LiveCommand, LiveConnection, LiveEvent, VoiceHost, VoiceStream } from "@chef/core";

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close" | "error", listener: (event: unknown) => void): void;
}

export type Connect = (url: string, headers: Record<string, string>) => Promise<SocketLike>;

export const LIVE_MODEL = "gpt-live-1";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface LiveOptions {
  readonly apiKey: string;
  readonly connect: Connect;
  readonly model?: string;
  readonly voice?: string;
  readonly baseUrl?: string;
}

function text(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}

function wsUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/^http/, "ws").replace(/\/$/, "")}${path}`;
}

function listen(socket: SocketLike, onEvent: (event: LiveEvent) => void): { closed: Promise<void>; finished: Promise<void> } {
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => (finish = resolve));
  socket.addEventListener("message", (message) => {
    let event: LiveEvent;
    try {
      event = JSON.parse(text(message.data)) as LiveEvent;
    } catch {
      onEvent({ type: "error", error: { message: "unparseable event from GPT-Live" } });
      return;
    }
    if (!event || typeof event.type !== "string") return;
    onEvent(event);
    if (event.type === "session.closed") finish();
  });
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve());
    socket.addEventListener("error", () => resolve());
  });
  void closed.then(finish);
  return { closed, finished };
}

function connection(socket: SocketLike, finished: Promise<void>): LiveConnection {
  return {
    send: (command: LiveCommand) => socket.send(JSON.stringify(command)),
    close: async () => {
      socket.send(JSON.stringify({ type: "session.close", event_id: "chef-close" }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([finished, new Promise((resolve) => (timer = setTimeout(resolve, 15_000)))]);
      clearTimeout(timer);
      socket.close(1000, "done");
    },
  };
}

function normalized(event: LiveEvent): LiveEvent {
  if (/output_audio\.delta$/.test(event.type)) return { type: "session.output_audio.delta", delta: event["delta"] ?? event["audio"] };
  if (/speech[._]started$/.test(event.type)) return { type: "session.input_speech.started" };
  return event;
}

export class GptLiveHost implements VoiceHost {
  readonly model: string;

  constructor(private readonly options: LiveOptions) {
    this.model = options.model ?? LIVE_MODEL;
  }

  async start(input: { readonly instructions: string; readonly onEvent: (event: LiveEvent) => void }): Promise<VoiceStream> {
    const session = await startServerSession({ ...this.options, model: this.model, instructions: input.instructions, onEvent: (event) => input.onEvent(normalized(event)) });
    return { sessionId: session.sessionId, connection: session.connection, sendAudio: (pcm) => session.sendAudio(pcm) };
  }
}

export interface ServerSession {
  readonly sessionId: string;
  readonly connection: LiveConnection;
  readonly closed: Promise<void>;
  sendAudio(pcm: Uint8Array): void;
}

export const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export async function startServerSession(options: LiveOptions & { readonly instructions: string; readonly onEvent: (event: LiveEvent) => void; readonly timeoutMs?: number }): Promise<ServerSession> {
  const baseUrl = options.baseUrl ?? OPENAI_BASE_URL;
  const socket = await options.connect(wsUrl(baseUrl, "/live/sessions"), { authorization: `Bearer ${options.apiKey}` });
  let started: (id: string) => void = () => {};
  let failed: (error: Error) => void = () => {};
  const ready = new Promise<string>((resolve, reject) => {
    started = resolve;
    failed = reject;
  });
  const { closed, finished } = listen(socket, (event) => {
    if (event.type === "session.started") started(String((event["session"] as { id?: unknown } | undefined)?.id ?? ""));
    if (event.type === "error") failed(new Error(`GPT-Live error: ${JSON.stringify(event["error"] ?? event)}`));
    options.onEvent(event);
  });
  void closed.then(() => failed(new Error("GPT-Live closed before the session started")));
  socket.send(
    JSON.stringify({
      type: "session.start",
      event_id: "chef-start",
      session: {
        model: options.model ?? LIVE_MODEL,
        instructions: options.instructions,
        audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice: options.voice ?? "marin" } },
        delegation: { type: "client" },
      },
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("GPT-Live did not start in time")), options.timeoutMs ?? 20_000)));
  const sessionId = await Promise.race([ready, timeout]).finally(() => clearTimeout(timer));
  return {
    sessionId,
    connection: connection(socket, finished),
    closed,
    sendAudio: (pcm) => {
      for (let i = 0; i < pcm.length; i += 9600) socket.send(JSON.stringify({ type: "session.input_audio.append", audio: encodeBase64(pcm.subarray(i, Math.min(pcm.length, i + 9600))) }));
    },
  };
}

export async function speak(options: { readonly apiKey: string; readonly text: string; readonly voice?: string; readonly model?: string; readonly baseUrl?: string; readonly fetchImpl?: typeof fetch }): Promise<Uint8Array> {
  const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl ?? OPENAI_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: options.model ?? "gpt-4o-mini-tts", voice: options.voice ?? "alloy", input: options.text, response_format: "pcm" }),
  });
  if (!response.ok) throw new Error(`speech synthesis failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  return new Uint8Array(await response.arrayBuffer());
}
