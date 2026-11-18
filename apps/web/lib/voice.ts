'use client';
/**
 * Voice providers (web):
 *  - STT: realtime streaming (AudioWorklet → API WS proxy → Meta muse-voice-transcribe-1.0); falls back to recording a
 *    clip and POSTing it for file transcription.
 *  - TTS: natural neural voices synthesised locally by the API (Kokoro) and played through Web Audio, with
 *    amplitude-driven lip-sync. Falls back to the most natural installed Web Speech voice (never blindly the
 *    system default, which is often a robotic eSpeak voice on Linux).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePref } from '@muse/core/avatar';
import type { VoiceConfig } from '@muse/core/client';
import { type DeviceVoiceLike, naturalPlayback, naturalVoiceSpeaks, pickDeviceVoice, splitForSpeech } from '@muse/core/voice';
import { api, API_URL } from './api';

export interface TTSProvider { readonly kind: 'natural' | 'device'; speak(text: string, onLevel: (v: number) => void): Promise<void>; stop(): void }

// ---------- shared audio context (must be unlocked by a user gesture once) ----------
let sharedCtx: AudioContext | null = null;
export function audioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext();
  return sharedCtx;
}
/** Call from a click/tap handler so later replies can play without another gesture. */
export function unlockAudio() {
  try {
    const ctx = audioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    window.speechSynthesis?.getVoices();
  } catch { /* no audio */ }
}

// ---------- server voice config ----------
let configPromise: Promise<VoiceConfig | null> | null = null;
export function loadVoiceConfig(force = false): Promise<VoiceConfig | null> {
  if (!configPromise || force) configPromise = api.voiceConfig().catch(() => null);
  return configPromise;
}
export function useVoiceConfig() {
  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  useEffect(() => { let on = true; void loadVoiceConfig().then((c) => { if (on) setCfg(c); }); return () => { on = false; }; }, []);
  return cfg;
}

// ---------- device (Web Speech) voices ----------
export function deviceVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((res) => {
    const done = () => { synth.removeEventListener?.('voiceschanged', done); res(synth.getVoices()); };
    synth.addEventListener?.('voiceschanged', done);
    setTimeout(done, 1200);
  });
}
export const asVoiceLike = (v: SpeechSynthesisVoice): DeviceVoiceLike & { voice: SpeechSynthesisVoice } => ({ id: v.voiceURI, name: v.name, lang: v.lang, localService: v.localService, voice: v });

export class DeviceTTS implements TTSProvider {
  readonly kind = 'device' as const;
  private cancelled = false;
  constructor(private pref: VoicePref, private lang: string) {}
  stop() { this.cancelled = true; window.speechSynthesis?.cancel(); }
  async speak(text: string, onLevel: (v: number) => void): Promise<void> {
    const synth = window.speechSynthesis;
    if (!synth) return;
    this.cancelled = false;
    synth.cancel();
    const voice = pickDeviceVoice((await deviceVoices()).map(asVoiceLike), this.lang, this.pref.voiceId)?.voice;
    // Lip-sync: pulse the mouth on word boundaries, with a gentle decay between them.
    let level = 0;
    const timer = setInterval(() => { level *= 0.75; onLevel(level); }, 50);
    try {
      // Chunking keeps Chrome from cutting long utterances off after ~15 s.
      for (const chunk of splitForSpeech(text)) {
        if (this.cancelled) break;
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(chunk);
          u.lang = voice?.lang ?? this.lang;
          if (voice) u.voice = voice;
          u.rate = this.pref.rate;
          u.pitch = this.pref.pitch;
          u.onboundary = () => { level = 0.9; };
          u.onstart = () => { level = 0.6; };
          u.onend = () => resolve();
          u.onerror = () => resolve();
          synth.speak(u);
        });
      }
    } finally {
      clearInterval(timer);
      onLevel(0);
    }
  }
}

// ---------- natural (server) voices ----------
export class NaturalTTS implements TTSProvider {
  readonly kind = 'natural' as const;
  private gen = 0;
  private source: AudioBufferSourceNode | null = null;
  constructor(private pref: VoicePref) {}
  stop() { this.gen++; try { this.source?.stop(); } catch { /* already stopped */ } this.source = null; }

  private async fetchChunk(text: string, speed: number): Promise<AudioBuffer> {
    const { audio } = await api.tts(text, this.pref.naturalVoice, speed);
    return audioContext().decodeAudioData(audio);
  }

  /** Throws if the very first chunk can't be synthesised, so the caller can fall back to device speech. */
  async speak(text: string, onLevel: (v: number) => void): Promise<void> {
    const my = ++this.gen;
    const chunks = splitForSpeech(text);
    if (!chunks.length) return;
    const { synthSpeed, playbackRate } = naturalPlayback(this.pref.rate, this.pref.pitch);
    const ctx = audioContext();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const d of data) peak = Math.max(peak, Math.abs(d - 128) / 128);
      onLevel(Math.min(1, peak * 2.4));
      raf = requestAnimationFrame(tick);
    };
    // Prefetch one chunk ahead so there are no gaps between sentences.
    let next: Promise<AudioBuffer> | null = this.fetchChunk(chunks[0]!, synthSpeed);
    try {
      for (let i = 0; i < chunks.length; i++) {
        let buf: AudioBuffer;
        try { buf = await next!; } catch (e) { if (i === 0) throw e; break; }
        if (my !== this.gen) return;
        next = i + 1 < chunks.length ? this.fetchChunk(chunks[i + 1]!, synthSpeed) : null;
        next?.catch(() => {});
        await new Promise<void>((resolve) => {
          const src = (this.source = ctx.createBufferSource());
          src.buffer = buf;
          src.playbackRate.value = playbackRate;
          src.connect(analyser);
          src.onended = () => resolve();
          if (!raf) tick();
          src.start();
        });
        if (my !== this.gen) return;
      }
    } finally {
      cancelAnimationFrame(raf);
      onLevel(0);
      analyser.disconnect();
    }
  }
}

/** Pick the engine for this preference + language. */
export function createTTS(pref: VoicePref, lang: string, cfg: VoiceConfig | null): TTSProvider {
  const natural = !!cfg?.natural.available && pref.provider !== 'device' && (pref.provider === 'server' || naturalVoiceSpeaks(lang));
  return natural ? new NaturalTTS(pref) : new DeviceTTS(pref, lang);
}

/** One-off voice preview (avatar page, onboarding). */
export async function previewVoice(pref: VoicePref, lang: string, text: string, onLevel: (v: number) => void = () => {}): Promise<'natural' | 'device'> {
  unlockAudio();
  const tts = createTTS(pref, lang, await loadVoiceConfig());
  try {
    await tts.speak(text, onLevel);
    return tts.kind;
  } catch {
    await new DeviceTTS(pref, lang).speak(text, onLevel);
    return 'device';
  }
}

export function useSpeech(pref: VoicePref, lang: string) {
  const mouth = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const cfg = useVoiceConfig();
  const provider = useRef<TTSProvider | null>(null);
  useEffect(() => {
    provider.current?.stop();
    provider.current = createTTS(pref, lang, cfg);
  }, [pref, lang, cfg]);
  const speak = useCallback(async (text: string) => {
    const p = provider.current ?? createTTS(pref, lang, cfg);
    provider.current = p;
    setSpeaking(true);
    try {
      await p.speak(text, (v) => { mouth.current = v; });
    } catch {
      // Natural voice unavailable right now (e.g. model still downloading): use the best device voice.
      await new DeviceTTS(pref, lang).speak(text, (v) => { mouth.current = v; });
    } finally {
      setSpeaking(false);
      mouth.current = 0;
    }
  }, [pref, lang, cfg]);
  const stop = useCallback(() => { provider.current?.stop(); window.speechSynthesis?.cancel(); setSpeaking(false); mouth.current = 0; }, []);
  return { speak, stop, speaking, mouth, engine: provider.current?.kind ?? (cfg?.natural.available ? 'natural' : 'device') };
}

/** Hold-to-talk / voice-mode recorder with live transcripts. */
export function useListener(lang: string) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [level, setLevel] = useState(0);
  const stopRef = useRef<(() => Promise<string>) | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    setListening(true);
    setPartial('');
    // Try realtime streaming first.
    try {
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule('/pcm-worklet.js');
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'pcm-worklet');
      const ws = new WebSocket(API_URL.replace(/^http/, 'ws') + '/v1/voice/stream');
      ws.binaryType = 'arraybuffer';
      let finalText = '';
      let current = '';
      ws.onmessage = (m) => {
        const e = JSON.parse(String(m.data));
        if (e.type !== 'transcript') return;
        if (e.final) { finalText += (finalText ? ' ' : '') + e.text; current = ''; } else current = e.text;
        setPartial([finalText, current].filter(Boolean).join(' '));
      };
      const opened = await new Promise<boolean>((res) => { ws.onopen = () => res(true); ws.onerror = () => res(false); setTimeout(() => res(false), 4000); });
      if (!opened) throw new Error('ws failed');
      node.port.onmessage = (e) => { setLevel(e.data.level); if (ws.readyState === 1) ws.send(e.data.pcm); };
      src.connect(node);
      stopRef.current = async () => {
        src.disconnect();
        node.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'endStream' }));
        await new Promise((r) => { ws.onclose = r; setTimeout(r, 2500); });
        void ctx.close();
        return [finalText, current].filter(Boolean).join(' ').trim();
      };
      return;
    } catch { /* fall back to clip upload */ }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    // Meter the mic so the avatar can react to your voice.
    let meterRaf = 0;
    let meterSrc: MediaStreamAudioSourceNode | null = null;
    try {
      const ctx = audioContext();
      meterSrc = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      meterSrc.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const meter = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const d of buf) peak = Math.max(peak, Math.abs(d - 128) / 128);
        setLevel(Math.min(1, peak * 2));
        meterRaf = requestAnimationFrame(meter);
      };
      meter();
    } catch { /* metering is optional */ }
    stopRef.current = async () => {
      cancelAnimationFrame(meterRaf);
      meterSrc?.disconnect();
      await new Promise<void>((r) => { rec.onstop = () => r(); rec.stop(); });
      stream.getTracks().forEach((t) => t.stop());
      const buf = new Uint8Array(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const { text } = await api.req<{ text: string }>('POST', '/v1/voice/transcribe', { audio: btoa(bin), mime: rec.mimeType, language: lang });
      return text;
    };
  }, [lang]);

  const stop = useCallback(async () => {
    const fn = stopRef.current;
    stopRef.current = null;
    setListening(false);
    setLevel(0);
    return fn ? fn() : '';
  }, []);

  return { start, stop, listening, partial, level };
}
