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

function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
    setTimeout(resolve, 3000);
  });
}

function meter(context: AudioContext | null, stream: MediaStream): () => number {
  if (!context || stream.getAudioTracks().length === 0) return () => 0;
  try {
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    return () => {
      analyser.getByteTimeDomainData(samples);
      return loudness(samples);
    };
  } catch {
    return () => 0;
  }
}

function audioContext(): AudioContext | null {
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

export async function startTalk(options: { readonly project: string; readonly onEvent: (event: VoiceEvent) => void; readonly onStatus: (status: string) => void }): Promise<Call> {
  const context = audioContext();
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    void context?.close().catch(() => {});
    throw error;
  }
  void context?.resume().catch(() => {});
  const pc = new RTCPeerConnection();
  const speaker = new Audio();
  speaker.autoplay = true;
  let chef: () => number = () => 0;
  pc.addEventListener("track", (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    speaker.srcObject = stream;
    chef = meter(context, stream);
  });
  for (const track of mic.getTracks()) pc.addTrack(track, mic);
  const you = meter(context, mic);
  let muted = false;
  const channel = pc.createDataChannel("oai-events");
  let closed = () => {};
  let live = false;
  const finished = new Promise<void>((resolve) => (closed = resolve));
  channel.addEventListener("message", (message) => {
    let event: VoiceEvent;
    try {
      event = JSON.parse(String(message.data)) as VoiceEvent;
    } catch {
      return;
    }
    if (event.type === "session.started" || event.type === "session.created") options.onStatus("listening");
    if (event.type === "session.started") live = true;
    if (event.type === "session.closed") closed();
    options.onEvent(event);
  });
  const release = () => {
    for (const track of mic.getTracks()) track.stop();
    speaker.srcObject = null;
    void context?.close().catch(() => {});
    pc.close();
  };
  let body: { sessionId?: string; sdp?: string; error?: string };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    options.onStatus("connecting");
    const response = await fetch(`/api/projects/${options.project}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription?.sdp }) });
    body = (await response.json().catch(() => ({}))) as typeof body;
    if (!response.ok || !body.sdp) throw new Error(body.error ?? `voice failed with ${response.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
  } catch (error) {
    release();
    throw error;
  }
  return {
    sessionId: body.sessionId ?? "",
    levels: () => ({ you: muted ? 0 : you(), chef: chef() }),
    mute: (next) => {
      muted = next;
      for (const track of mic.getAudioTracks()) track.enabled = !next;
    },
    end: async () => {
      for (const track of mic.getTracks()) track.stop();
      speaker.pause();
      if (live && channel.readyState === "open") {
        channel.send(JSON.stringify({ type: "session.close", event_id: "dashboard-close" }));
        await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 15000))]);
      }
      release();
    },
  };
}
