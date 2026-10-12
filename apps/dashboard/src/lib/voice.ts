export interface Heard {
  readonly speaker: "you" | "chef";
  text: string;
}

interface VoiceEvent {
  readonly type: string;
  readonly delta?: unknown;
}

export function transcript(lines: Heard[], event: VoiceEvent): Heard[] {
  const said = event.type === "session.input_transcript.delta" || event.type === "conversation.item.input_audio_transcription.delta";
  const spoken = event.type === "session.output_transcript.delta" || event.type === "response.output_audio_transcript.delta";
  const speaker = said ? "you" : spoken ? "chef" : null;
  if (!speaker || typeof event.delta !== "string") return lines;
  const next = [...lines];
  const last = next[next.length - 1];
  if (last && last.speaker === speaker) next[next.length - 1] = { speaker, text: last.text + event.delta };
  else next.push({ speaker, text: event.delta });
  return next.slice(-20);
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

export async function startTalk(options: { readonly project: string; readonly onEvent: (event: VoiceEvent) => void; readonly onStatus: (status: string) => void }): Promise<() => Promise<void>> {
  const pc = new RTCPeerConnection();
  const speaker = new Audio();
  speaker.autoplay = true;
  pc.addEventListener("track", (event) => {
    speaker.srcObject = event.streams[0] ?? null;
  });
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of mic.getTracks()) pc.addTrack(track, mic);
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
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  options.onStatus("connecting");
  const response = await fetch(`/api/projects/${options.project}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription?.sdp }) });
  const body = (await response.json()) as { sdp?: string; error?: string };
  if (!response.ok || !body.sdp) {
    for (const track of mic.getTracks()) track.stop();
    pc.close();
    throw new Error(body.error ?? `voice failed with ${response.status}`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
  return async function stop() {
    if (live && channel.readyState === "open") {
      channel.send(JSON.stringify({ type: "session.close", event_id: "dashboard-close" }));
      await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 15000))]);
    }
    for (const track of mic.getTracks()) track.stop();
    pc.close();
    options.onStatus("off");
  };
}
