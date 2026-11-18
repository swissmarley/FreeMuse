/* AudioWorklet: downsample mic input to 24 kHz mono PCM16 and post 80 ms frames (as Meta realtime STT expects). */
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 24000;
    this.buf = [];
    this.pos = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }
    this.pos -= ch.length;
    let level = 0;
    for (let i = 0; i < ch.length; i++) level = Math.max(level, Math.abs(ch[i]));
    if (this.buf.length >= 1920) {
      const out = new Int16Array(this.buf.splice(0, 1920));
      this.port.postMessage({ pcm: out.buffer, level }, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
