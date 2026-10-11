export function transcript(lines, event) {
  const speaker = event.type === "session.input_transcript.delta" ? "you" : event.type === "session.output_transcript.delta" ? "kargah" : null;
  if (!speaker || typeof event.delta !== "string") return lines;
  const last = lines[lines.length - 1];
  if (last && last.speaker === speaker) last.text += event.delta;
  else lines.push({ speaker, text: event.delta });
  if (lines.length > 20) lines.splice(0, lines.length - 20);
  return lines;
}

function gathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === "complete") resolve();
    };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, 3000);
  });
}

export async function startTalk({ project, onEvent, onStatus }) {
  const pc = new RTCPeerConnection();
  const speaker = new Audio();
  speaker.autoplay = true;
  pc.addEventListener("track", (event) => {
    speaker.srcObject = event.streams[0];
  });
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of mic.getTracks()) pc.addTrack(track, mic);
  const channel = pc.createDataChannel("oai-events");
  let closed = () => {};
  const finished = new Promise((resolve) => (closed = resolve));
  channel.addEventListener("message", (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    if (event.type === "session.started") onStatus("listening");
    if (event.type === "session.closed") closed();
    onEvent(event);
  });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  onStatus("connecting");
  const response = await fetch(`/api/projects/${project}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription.sdp }) });
  const body = await response.json();
  if (!response.ok) {
    for (const track of mic.getTracks()) track.stop();
    pc.close();
    throw new Error(body.error ?? `voice failed with ${response.status}`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
  return async function stop() {
    if (channel.readyState === "open") {
      channel.send(JSON.stringify({ type: "session.close", event_id: "dashboard-close" }));
      await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 15000))]);
    }
    for (const track of mic.getTracks()) track.stop();
    pc.close();
    onStatus("off");
  };
}
