'use client';
/**
 * Hands-free voice call engine (web), like a phone call:
 *  - the microphone stays open for the whole call (echo cancellation + noise suppression),
 *  - a voice activity detector decides when you start and stop talking,
 *  - while you talk, audio streams to the realtime transcriber for live captions,
 *  - when you pause, the utterance is transcribed (with a language hint) and handed to the call,
 *  - while the assistant speaks, talking louder than its voice interrupts it ("barge-in").
 */
import { BARGE_IN_VAD, DEFAULT_VAD, rmsToLevel, Vad } from '@muse/core/voice';
import { api, API_URL } from './api';

export type MicMode = 'listen' | 'barge' | 'off';

export interface CallMicEvents {
  level(v: number): void;
  speechStart(barge: boolean): void;
  partial(text: string): void;
  utterance(text: string): void;
  /** Speech that was too short to be a turn (a cough, a click). */
  blip(): void;
}

const FRAME_MS = 80; // the PCM worklet posts 80 ms frames (1920 samples at 24 kHz)
const PREROLL_FRAMES = 6;
const MAX_UTTERANCE_FRAMES = Math.round(DEFAULT_VAD.maxSpeechMs / FRAME_MS) + PREROLL_FRAMES;

/** 24 kHz mono PCM16 frames → WAV file bytes. */
export function pcmToWav(frames: ArrayBuffer[], sampleRate = 24000): Uint8Array {
  const len = frames.reduce((n, f) => n + f.byteLength, 0);
  const out = new Uint8Array(44 + len);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, len, true);
  let o = 44;
  for (const f of frames) { out.set(new Uint8Array(f), o); o += f.byteLength; }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class CallMic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private vad = new Vad(DEFAULT_VAD);
  private mode: MicMode = 'off';
  private preroll: ArrayBuffer[] = [];
  private utter: ArrayBuffer[] | null = null;
  private ws: WebSocket | null = null;
  private wsText = { final: '', current: '' };
  private realtime = true;
  private stopped = false;

  constructor(private lang: string, private on: CallMicEvents) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule('/pcm-worklet.js');
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-worklet');
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => this.frame(e.data.pcm, rmsToLevel(e.data.rms));
    this.src.connect(this.node);
  }

  setMode(m: MicMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.vad.opts = m === 'barge' ? BARGE_IN_VAD : DEFAULT_VAD;
    // Leaving listening mid-utterance (e.g. muted) drops what was being said.
    if (m === 'off' && this.utter) this.abortUtterance();
    if (m !== 'off') this.vad.reset();
  }

  stop() {
    this.stopped = true;
    this.abortUtterance();
    try { this.src?.disconnect(); this.node?.disconnect(); } catch { /* gone */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
  }

  private frame(pcm: ArrayBuffer, level: number) {
    if (this.stopped) return;
    this.on.level(this.mode === 'off' ? 0 : level);
    this.preroll.push(pcm);
    if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    if (this.mode === 'off') {
      // Keep learning the room's background noise while muted / thinking, so the next turn starts calibrated.
      this.vad.observe(level, performance.now());
      return;
    }
    if (this.utter) {
      this.utter.push(pcm);
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
      if (this.utter.length > MAX_UTTERANCE_FRAMES) void this.finish();
    }
    const ev = this.vad.push(level, performance.now());
    if (ev === 'speech-start') {
      const barge = this.mode === 'barge';
      if (barge) {
        // The caller took over: keep the turn the VAD just started (setMode would reset it and start a second one).
        this.mode = 'listen';
        this.vad.opts = DEFAULT_VAD;
      }
      this.beginUtterance();
      this.on.speechStart(barge);
    } else if (ev === 'speech-end') void this.finish();
    else if (ev === 'blip') { this.abortUtterance(); this.on.blip(); }
  }

  private beginUtterance() {
    this.utter = [...this.preroll];
    this.wsText = { final: '', current: '' };
    if (!this.realtime) return;
    try {
      const ws = new WebSocket(API_URL.replace(/^http/, 'ws') + '/v1/voice/stream');
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { for (const f of this.utter ?? []) ws.send(f); };
      ws.onmessage = (m) => {
        const e = JSON.parse(String(m.data)) as { type: string; text?: string; final?: boolean };
        if (e.type !== 'transcript' || !e.text) return;
        if (e.final) { this.wsText.final += (this.wsText.final ? ' ' : '') + e.text; this.wsText.current = ''; } else this.wsText.current = e.text;
        this.on.partial([this.wsText.final, this.wsText.current].filter(Boolean).join(' '));
      };
      ws.onerror = () => { this.realtime = false; };
      this.ws = ws;
    } catch { this.realtime = false; }
  }

  private abortUtterance() {
    this.utter = null;
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
  }

  private async finish() {
    const frames = this.utter;
    const ws = this.ws;
    this.utter = null;
    this.ws = null;
    if (!frames) return;
    // Let the realtime transcriber flush its last words (it gives the live captions).
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'endStream' }));
      await new Promise((r) => { ws.onclose = r; setTimeout(r, 1200); });
    }
    try { ws?.close(); } catch { /* gone */ }
    const live = [this.wsText.final, this.wsText.current].filter(Boolean).join(' ').trim();
    let text = '';
    // The file transcriber takes a language hint, so it is the most accurate for every language.
    try {
      text = (await api.transcribe(toBase64(pcmToWav(frames)), 'audio/wav', this.lang)).text.trim();
    } catch {
      text = live;
    }
    if (!this.stopped) this.on.utterance(text || live);
  }
}

// ---------- little phone sounds (synthesised, no files) ----------
function tone(ctx: AudioContext, freqs: number[], start: number, dur: number, vol = 0.08) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(vol, start + 0.02);
  g.gain.setValueAtTime(vol, start + dur - 0.04);
  g.gain.linearRampToValueAtTime(0, start + dur);
  g.connect(ctx.destination);
  for (const f of freqs) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.connect(g);
    o.start(start);
    o.stop(start + dur);
  }
}

/** Ring-back tone: two short rings. Resolves when it's done. */
export function playRingback(ctx: AudioContext): Promise<void> {
  const t = ctx.currentTime + 0.05;
  tone(ctx, [440, 480], t, 0.9, 0.06);
  tone(ctx, [440, 480], t + 1.5, 0.9, 0.06);
  return new Promise((r) => setTimeout(r, 2500));
}
export function playConnect(ctx: AudioContext) {
  const t = ctx.currentTime + 0.01;
  tone(ctx, [660], t, 0.09, 0.05);
  tone(ctx, [880], t + 0.11, 0.12, 0.05);
}
export function playHangup(ctx: AudioContext) {
  const t = ctx.currentTime + 0.01;
  tone(ctx, [620], t, 0.12, 0.05);
  tone(ctx, [480], t + 0.15, 0.18, 0.05);
}
