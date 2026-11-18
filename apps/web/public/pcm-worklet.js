/* AudioWorklet: downsample mic input to 24 kHz mono PCM16 and post 80 ms frames (as Meta realtime STT expects),
 * each with the RMS loudness of the whole frame (a steadier signal for voice detection than a peak). */
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 24000;
    this.buf = [];
    this.pos = 0;
    this.sumSq = 0;
    this.count = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }
    this.pos -= ch.length;
    for (let i = 0; i < ch.length; i++) this.sumSq += ch[i] * ch[i];
    this.count += ch.length;
    if (this.buf.length >= 1920) {
      const out = new Int16Array(this.buf.splice(0, 1920));
      const rms = this.count ? Math.sqrt(this.sumSq / this.count) : 0;
      this.sumSq = 0;
      this.count = 0;
      this.port.postMessage({ pcm: out.buffer, rms }, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
