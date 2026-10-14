export const LIVE_MOCK = `
(() => {
  const voice = { channel: null, sent: [], closed: false, sockets: 0 };
  window.__voice = voice;
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const osc = context.createOscillator();
    const level = context.createGain();
    level.gain.value = 0;
    const out = context.createMediaStreamDestination();
    osc.connect(level).connect(out);
    osc.start();
    return out.stream;
  };
  class FakeVoiceSocket extends EventTarget {
    readyState = 0;
    binaryType = "blob";
    constructor(url) {
      super();
      this.url = url;
      voice.channel = this;
      voice.closed = false;
      voice.sockets++;
      setTimeout(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
        this.emit({ type: "session.started", session: { id: "voice" + voice.sockets } });
      }, 30);
    }
    send(data) {
      voice.sent.push(data);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      voice.closed = true;
      this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
    }
    emit(event) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
    }
  }
  const Real = window.WebSocket;
  window.WebSocket = class extends Real {
    constructor(url, protocols) {
      if (String(url).includes("voice=1")) return new FakeVoiceSocket(url);
      super(url, protocols);
    }
  };
})();
`;
