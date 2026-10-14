import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeature, readSpec, startVoiceCall, type LiveCommand, type SubmitResult, type VoiceHost } from "@chef/core";
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

async function synthesize(options: { readonly baseUrl: string; readonly apiKey: string; readonly connect: Connect }, text: string): Promise<Uint8Array> {
  const { startRealtimeSession } = await import("@chef/adapters/realtime");
  const chunks: Uint8Array[] = [];
  let last = 0;
  const session = await startRealtimeSession({
    ...options,
    instructions: `You are a text-to-speech voice, not an assistant. Whatever the user says, you only say this exact sentence, word for word, in a natural voice, and nothing else: "${text}"`,
    onEvent: (event) => {
      if (event.type !== "session.output_audio.delta" || typeof event["delta"] !== "string") return;
      chunks.push(Uint8Array.from(Buffer.from(event["delta"], "base64")));
      last = Date.now();
    },
  });
  session.say("Go.");
  await until(() => last > 0 && Date.now() - last > 1500, 30_000);
  await session.connection.close();
  if (!chunks.length) throw new Error("the Realtime provider returned no audio to speak the request with");
  return Uint8Array.from(Buffer.concat(chunks));
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
    const call = await startVoiceCall({ host, target: w.orchestrator, spec, ids: new SequentialIds() });
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
    const replies: string[] = [];
    let pcm: Uint8Array;
    let host: VoiceHost;
    if (provider.kind === "openai") {
      const { GptLiveHost, speak } = await import("@chef/adapters/gpt-live");
      log(`synthesizing "${options.say}"`);
      pcm = await speak({ apiKey: provider.apiKey, text: options.say });
      host = new GptLiveHost({ apiKey: provider.apiKey, connect: nodeConnect });
    } else {
      const { RealtimeHost } = await import("@chef/adapters/realtime");
      log(`synthesizing "${options.say}" through ${provider.baseUrl}`);
      pcm = await synthesize({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, connect: nodeConnect }, options.say);
      host = new RealtimeHost({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, connect: nodeConnect });
    }
    log(`speaking ${(pcm.length / 48000).toFixed(1)}s of audio to chef`);
    const call = await startVoiceCall({
      host,
      target: w.orchestrator,
      spec,
      ids: new SequentialIds(),
      settle: () => new Promise((resolve) => setTimeout(resolve, 800)),
      onEvent: (event) => {
        if (event.type === "session.output_transcript.delta" && typeof event["delta"] === "string") chefSaid += event["delta"];
        if (event.type === "session.input_transcript.delta" && typeof event["delta"] === "string") log(`heard: ${event["delta"]}`);
        if (event.type === "session.input_transcript.done" && typeof event["transcript"] === "string") log(`heard in full: ${event["transcript"]}`);
        if (event.type === "session.delegation.created") log("delegated to chef");
        if (event.type === "error") log(`error: ${JSON.stringify(event["error"] ?? event)}`);
      },
    });
    voiceSessionId = call.sessionId;
    const send = call.connection.send.bind(call.connection);
    call.connection.send = (command: LiveCommand) => {
      if (command.type === "session.commentary.append") replies.push(command.content);
      send(command);
    };
    call.sendAudio(pcm);
    call.sendAudio(new Uint8Array(24000 * 2 * 2));
    if (!(await until(() => call.delegate.requests.length > 0, 60_000))) log("the voice model never delegated the request");
    await call.delegate.idle();
    await until(() => chefSaid.length > 0, 15_000);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await call.connection.close();
    const request = call.delegate.requests[0];
    heard = request?.prompt ?? null;
    result = request?.result ?? null;
    reply = replies[0] ?? null;
  }

  let state = "not started";
  let mergedCommit: string | null = null;
  if (result?.sessionId) {
    const record = await w.orchestrator.run(result.sessionId);
    state = record.machine.state;
    if (state === "stuck") log(`the build got stuck: ${record.machine.reason ?? "no reason"}\n${record.machine.feedback ?? ""}`);
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
