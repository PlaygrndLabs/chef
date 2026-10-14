export interface Heard {
  readonly speaker: "you" | "chef";
  readonly text: string;
  readonly at: number;
}

interface VoiceEvent {
  readonly type: string;
  readonly delta?: unknown;
}

export function transcript(lines: readonly Heard[], event: VoiceEvent, now = Date.now()): Heard[] {
  const said = event.type === "session.input_transcript.delta" || event.type === "conversation.item.input_audio_transcription.delta";
  const spoken = event.type === "session.output_transcript.delta" || event.type === "response.output_audio_transcript.delta";
  const speaker = said ? "you" : spoken ? "chef" : null;
  if (!speaker || typeof event.delta !== "string") return [...lines];
  const next = [...lines];
  const last = next[next.length - 1];
  if (last && last.speaker === speaker) next[next.length - 1] = { ...last, text: last.text + event.delta };
  else next.push({ speaker, text: event.delta, at: now });
  return next.slice(-60);
}

export function loudness(samples: Uint8Array): number {
  let sum = 0;
  for (const sample of samples) {
    const value = (sample - 128) / 128;
    sum += value * value;
  }
  return samples.length ? Math.min(1, Math.sqrt(sum / samples.length) * 4) : 0;
}

export interface Levels {
  readonly you: number;
  readonly chef: number;
}

export interface Call {
  readonly sessionId: string;
  readonly levels: () => Levels;
  readonly mute: (muted: boolean) => void;
  readonly end: () => Promise<void>;
}

const RATE = 24000;

const CAPTURE = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / ${RATE};
    this.pos = 0;
    this.pcm = new Int16Array(${RATE / 10});
    this.at = 0;
  }
  push(value) {
    const v = Math.max(-1, Math.min(1, value));
    this.pcm[this.at++] = v < 0 ? v * 0x8000 : v * 0x7fff;
    if (this.at < this.pcm.length) return;
    this.port.postMessage(this.pcm.buffer, [this.pcm.buffer]);
    this.pcm = new Int16Array(${RATE / 10});
    this.at = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    while (this.pos < input.length) {
      const i = Math.floor(this.pos);
      const a = input[i];
      const b = i + 1 < input.length ? input[i + 1] : a;
      this.push(a + (b - a) * (this.pos - i));
      this.pos += this.step;
    }
    this.pos -= input.length;
    return true;
  }
}
registerProcessor("chef-capture", Capture);
`;

function meter(analyser: AnalyserNode): () => number {
  const samples = new Uint8Array(analyser.fftSize);
  return () => {
    analyser.getByteTimeDomainData(samples);
    return loudness(samples);
  };
}

function pcmOf(base64: string): Float32Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

function voiceUrl(project: string): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/agents/project/${project}?voice=1`;
}

export async function startTalk(options: { readonly project: string; readonly onEvent: (event: VoiceEvent) => void; readonly onStatus: (status: string) => void }): Promise<Call> {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const context = new AudioContext();
  const stopMic = () => {
    for (const track of mic.getTracks()) track.stop();
  };
  let socket: WebSocket | null = null;
  const release = () => {
    stopMic();
    socket?.close(1000, "done");
    void context.close().catch(() => {});
  };
  try {
    await context.resume().catch(() => {});
    await context.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE], { type: "application/javascript" })));
  } catch (error) {
    release();
    throw error;
  }
  const source = context.createMediaStreamSource(mic);
  const heard = context.createAnalyser();
  heard.fftSize = 512;
  const capture = new AudioWorkletNode(context, "chef-capture");
  const sink = context.createGain();
  sink.gain.value = 0;
  source.connect(heard);
  source.connect(capture).connect(sink).connect(context.destination);
  const said = context.createAnalyser();
  said.fftSize = 512;
  said.connect(context.destination);
  const you = meter(heard);
  const chef = meter(said);
  const playing = new Set<AudioBufferSourceNode>();
  let playAt = 0;
  const play = (base64: string) => {
    const samples = pcmOf(base64);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, RATE);
    buffer.copyToChannel(samples, 0);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(said);
    playAt = Math.max(playAt, context.currentTime + 0.05);
    node.start(playAt);
    playAt += buffer.duration;
    playing.add(node);
    node.addEventListener("ended", () => playing.delete(node));
  };
  const hush = () => {
    for (const node of playing) node.stop();
    playing.clear();
    playAt = 0;
  };
  let muted = false;
  let ended = false;
  options.onStatus("connecting");
  const open = new WebSocket(voiceUrl(options.project));
  socket = open;
  open.binaryType = "arraybuffer";
  capture.port.addEventListener("message", (message: MessageEvent<ArrayBuffer>) => {
    if (!muted && open.readyState === WebSocket.OPEN) open.send(message.data);
  });
  capture.port.start();
  const started = new Promise<string>((resolve, reject) => {
    let sessionId = "";
    let problem = "";
    open.addEventListener("message", (message) => {
      let event: VoiceEvent & { readonly session?: { readonly id?: unknown }; readonly error?: { readonly message?: unknown } };
      try {
        event = JSON.parse(String(message.data)) as typeof event;
      } catch {
        return;
      }
      if (event.type === "session.output_audio.delta" && typeof event.delta === "string") play(event.delta);
      if (event.type === "session.input_speech.started") hush();
      if (event.type === "error" && typeof event.error?.message === "string") problem = event.error.message;
      if (event.type === "session.started") {
        sessionId = typeof event.session?.id === "string" ? event.session.id : "";
        options.onStatus("listening");
        resolve(sessionId);
      }
      if (event.type === "session.closed") {
        ended = true;
        reject(new Error(problem || "chef ended the live talk"));
      }
      options.onEvent(event);
    });
    open.addEventListener("close", () => {
      if (!ended) options.onEvent({ type: "session.closed" });
      reject(new Error(problem || "the live talk connection closed"));
    });
    setTimeout(() => reject(new Error("live talk did not start in time")), 25_000);
  });
  let sessionId: string;
  try {
    sessionId = await started;
  } catch (error) {
    ended = true;
    release();
    throw error;
  }
  return {
    sessionId,
    levels: () => ({ you: muted ? 0 : you(), chef: chef() }),
    mute: (next) => {
      muted = next;
      for (const track of mic.getAudioTracks()) track.enabled = !next;
    },
    end: async () => {
      ended = true;
      hush();
      release();
    },
  };
}
