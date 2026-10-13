import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeature, readSpec, startVoiceCall, voiceInstructions, VoiceDelegate, type LiveCommand, type LiveConnection, type LiveEvent, type SubmitResult } from "@chef/core";
import { ScriptedVoiceHost, SequentialIds } from "@chef/core/fakes";
import type { Connect, SocketLike } from "@chef/adapters/gpt-live";
import { voiceFromEnv } from "@chef/adapters/settings";
import { readTree } from "./fs.ts";
import { demoScript } from "./demo.ts";
import { localWorld, REPO_ROOT, templateTree } from "./world.ts";

export const VOICE_PROMPT = "Add an item to a todo list";

export interface VoiceRun {
  readonly mode: "scripted" | "live";
  readonly said: string;
  readonly heard: string | null;
  readonly intent: string | null;
  readonly featureId: string | null;
  readonly reply: string | null;
  readonly chefSaid: string;
  readonly state: string;
  readonly mergedCommit: string | null;
  readonly humanActions: number;
  readonly voiceSessionId: string;
}

export const nodeConnect: Connect = (url, headers) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers } as unknown as string[]);
    socket.addEventListener("open", () => resolve(socket as unknown as SocketLike));
    socket.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)));
  });

function world(real: boolean) {
  const fixture = readTree(join(REPO_ROOT, "core", "test", "fixtures", "todo"));
  const spec = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
  if (!spec.ok) throw new Error(spec.errors.join("\n"));
  return localWorld({ script: demoScript(fixture), presets: new Map([[VOICE_PROMPT, spec.spec]]), real });
}

async function until(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return true;
}

export async function runVoice(options: { readonly say: string; readonly live: boolean; readonly real: boolean; readonly log?: (line: string) => void }): Promise<VoiceRun> {
  const log = options.log ?? (() => {});
  const w = world(options.real);
  await w.orchestrator.bootstrap(templateTree());
  const spec = readSpec((await w.orchestrator.mainTree()).tree);
  let chefSaid = "";
  let result: SubmitResult | null;
  let heard: string | null;
  let reply: string | null;
  let voiceSessionId: string;

  if (!options.live) {
    const host = new ScriptedVoiceHost();
    const call = await startVoiceCall({ host, target: w.orchestrator, spec, sdp: "scripted-offer", ids: new SequentialIds() });
    voiceSessionId = call.sessionId;
    host.say(options.say);
    await call.delegate.idle();
    const request = call.delegate.requests[0];
    heard = request?.prompt ?? null;
    result = request?.result ?? null;
    reply = host.spoken()[0] ?? null;
    chefSaid = reply ?? "";
  } else {
    const provider = voiceFromEnv(process.env);
    if (!provider) throw new Error("--live needs OPENAI_API_KEY, or VOICE_BASE_URL and VOICE_API_KEY for a custom Realtime provider");
    let send: (command: LiveCommand) => void = () => {};
    const replies: string[] = [];
    let delegate: VoiceDelegate | null = null;
    const pending: LiveEvent[] = [];
    const onEvent = (event: LiveEvent) => {
      if (event.type === "session.output_transcript.delta" && typeof event["delta"] === "string") chefSaid += event["delta"];
      if (event.type === "session.input_transcript.delta" && typeof event["delta"] === "string") log(`heard: ${event["delta"]}`);
      if (event.type === "session.delegation.created") log("delegated to chef");
      if (event.type === "error") log(`error: ${JSON.stringify(event["error"] ?? event)}`);
      if (delegate) void delegate.handle(event);
      else pending.push(event);
    };
    let session: { readonly sessionId: string; readonly connection: LiveConnection; feed(): void };
    if (provider.kind === "openai") {
      const apiKey = provider.apiKey;
      const { speak, startServerSession } = await import("@chef/adapters/gpt-live");
      log(`synthesizing "${options.say}"`);
      const pcm = await speak({ apiKey, text: options.say });
      const live = await startServerSession({ apiKey, instructions: voiceInstructions(spec), onEvent, connect: nodeConnect });
      log(`GPT-Live session ${live.sessionId}`);
      session = { sessionId: live.sessionId, connection: live.connection, feed: () => (live.sendAudio(pcm), live.sendAudio(new Uint8Array(24000 * 2 * 2))) };
    } else {
      const { startRealtimeSession } = await import("@chef/adapters/realtime");
      const live = await startRealtimeSession({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, instructions: voiceInstructions(spec), onEvent, connect: nodeConnect });
      log(`Realtime session through ${provider.baseUrl}; the request is sent as text`);
      session = { sessionId: `realtime-${Date.now()}`, connection: live.connection, feed: () => live.say(options.say) };
    }
    voiceSessionId = session.sessionId;
    send = (command) => {
      if (command.type === "session.commentary.append") replies.push(command.content);
      session.connection.send(command);
    };
    delegate = new VoiceDelegate(session.sessionId, w.orchestrator, (command) => send(command), new SequentialIds(), () => new Promise((resolve) => setTimeout(resolve, 800)));
    for (const event of pending.splice(0)) void delegate.handle(event);
    session.feed();
    const active = delegate;
    if (!(await until(() => active.requests.length > 0, 60_000))) log("the voice model never delegated the request");
    await active.idle();
    await until(() => chefSaid.length > 0, 15_000);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await session.connection.close();
    const request = active.requests[0];
    heard = request?.prompt ?? null;
    result = request?.result ?? null;
    reply = replies[0] ?? null;
  }

  let state = "not started";
  let mergedCommit: string | null = null;
  if (result?.sessionId) {
    const record = await w.orchestrator.run(result.sessionId);
    state = record.machine.state;
    mergedCommit = record.merge?.commitId ?? null;
  }
  return {
    mode: options.live ? "live" : "scripted",
    said: options.say,
    heard,
    intent: result?.decision.intent ?? null,
    featureId: result?.featureId ?? result?.decision.featureId ?? null,
    reply,
    chefSaid: chefSaid.trim(),
    state,
    mergedCommit,
    humanActions: (await w.orchestrator.sessions()).filter((s) => s.machine.state === "stuck").length,
    voiceSessionId,
  };
}
