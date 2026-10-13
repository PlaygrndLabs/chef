export const LIVE_MOCK = `
(() => {
  const voice = { channel: null, sent: [], tone: null };
  window.__voice = voice;
  const tone = (gain) => {
    const context = new AudioContext();
    const osc = context.createOscillator();
    const level = context.createGain();
    level.gain.value = gain;
    const out = context.createMediaStreamDestination();
    osc.connect(level).connect(out);
    osc.start();
    return { stream: out.stream, level };
  };
  navigator.mediaDevices.getUserMedia = async () => {
    voice.mic = tone(0);
    return voice.mic.stream;
  };
  class FakeChannel extends EventTarget {
    readyState = "open";
    send(data) {
      voice.sent.push(data);
      if (JSON.parse(data).type === "session.close") setTimeout(() => this.emit({ type: "session.closed" }), 10);
    }
    emit(event) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
    }
  }
  class FakePeer extends EventTarget {
    iceGatheringState = "complete";
    localDescription = null;
    createDataChannel() {
      voice.channel = new FakeChannel();
      return voice.channel;
    }
    addTrack() {}
    async createOffer() {
      return { type: "offer", sdp: "v=0 fake offer" };
    }
    async setLocalDescription(description) {
      this.localDescription = description;
    }
    async setRemoteDescription() {
      voice.chef = tone(0);
      const event = new Event("track");
      event.streams = [voice.chef.stream];
      event.track = voice.chef.stream.getAudioTracks()[0];
      this.dispatchEvent(event);
      setTimeout(() => voice.channel.emit({ type: "session.started", session: { id: "voice1" } }), 50);
    }
    close() {}
  }
  window.RTCPeerConnection = FakePeer;
})();
`;
