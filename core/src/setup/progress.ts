export const SETUP_STREAM = "application/x-ndjson";

export type SetupNote = { readonly type: "step"; readonly label: string } | { readonly type: "log"; readonly text: string };

export type SetupEvent = (SetupNote & { readonly at: number }) | { readonly type: "done"; readonly at: number; readonly result: Readonly<Record<string, unknown>> } | { readonly type: "error"; readonly at: number; readonly status: number; readonly error: string };

export interface SetupProgress {
  step(label: string): void;
  log(text: string): void;
}

export const quietSetup: SetupProgress = { step: () => undefined, log: () => undefined };

export class SetupError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function wantsSetupStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes(SETUP_STREAM);
}

export async function setupResponse(request: Request, run: (progress: SetupProgress) => Promise<Readonly<Record<string, unknown>>>, status = 200, now: () => number = Date.now): Promise<Response> {
  if (!wantsSetupStream(request)) {
    try {
      return Response.json(await run(quietSetup), { status });
    } catch (error) {
      return failure(error);
    }
  }
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let open = true;
  const send = (event: SetupEvent) => {
    if (!open) return;
    writer.write(encoder.encode(`${JSON.stringify(event)}\n`)).catch(() => {
      open = false;
    });
  };
  const progress: SetupProgress = {
    step: (label) => send({ type: "step", label, at: now() }),
    log: (text) => send({ type: "log", text, at: now() }),
  };
  void (async () => {
    try {
      const result = await run(progress);
      send({ type: "done", at: now(), result });
    } catch (error) {
      const { status: code, message } = describe(error);
      send({ type: "error", at: now(), status: code, error: message });
    } finally {
      open = false;
      await writer.close().catch(() => undefined);
    }
  })();
  return new Response(readable, { status, headers: { "content-type": SETUP_STREAM, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function describe(error: unknown): { status: number; message: string } {
  if (error instanceof SetupError) return { status: error.status, message: error.message };
  return { status: 500, message: error instanceof Error ? error.message : String(error) };
}

function failure(error: unknown): Response {
  const { status, message } = describe(error);
  if (status === 500) console.error("setup failed", error);
  return Response.json({ error: message }, { status });
}

export async function* readSetupStream(response: Response): AsyncGenerator<SetupEvent> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as SetupEvent;
    }
    if (done) return;
  }
}
