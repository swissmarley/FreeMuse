'use client';
/**
 * Voice providers (web):
 *  - STT: captures 24 kHz PCM (AudioWorklet) and transcribes the clip with a language hint; the realtime stream
 *    (API WS proxy → Meta muse-voice-transcribe-1.0) only drives live captions. Without AudioWorklet, a compressed
 *    clip is recorded and POSTed instead.
 *  - TTS: professional ElevenLabs voices (the user's own key, every language) or natural neural voices synthesised
 *    locally by the API (Kokoro, English), played through Web Audio with amplitude-driven lip-sync. Falls back to the
 *    most natural installed Web Speech voice for the user's language (never blindly the system default).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePref } from '@muse/core/avatar';
import type { VoiceConfig } from '@muse/core/client';
import { speechLocale } from '@muse/core/i18n';
import { chooseTtsEngine, type DeviceVoiceLike, naturalPlayback, pickDeviceVoice, rmsToLevel, splitForSpeech, type TtsEngine } from '@muse/core/voice';
import { api, API_URL } from './api';
import { pcmToWav, toBase64 } from './call';

const FRAME_MS = 80; // the PCM worklet posts 80 ms frames

export interface TTSProvider { readonly kind: TtsEngine; speak(text: string, onLevel: (v: number) => void): Promise<void>; stop(): void }

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
    const locale = speechLocale(this.lang);
    const voice = pickDeviceVoice((await deviceVoices()).map(asVoiceLike), locale, this.pref.voiceId)?.voice;
    // Lip-sync: pulse the mouth on word boundaries, with a gentle decay between them.
    let level = 0;
    const timer = setInterval(() => { level *= 0.75; onLevel(level); }, 50);
    try {
      // Chunking keeps Chrome from cutting long utterances off after ~15 s.
      for (const chunk of splitForSpeech(text)) {
        if (this.cancelled) break;
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(chunk);
          u.lang = voice?.lang ?? locale;
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

// ---------- server voices: ElevenLabs (user's key) or natural (Kokoro on the server) ----------
export class ServerTTS implements TTSProvider {
  private gen = 0;
  private source: AudioBufferSourceNode | null = null;
  constructor(private pref: VoicePref, readonly kind: 'natural' | 'elevenlabs' = 'natural', private lang = 'en') {}
  stop() { this.gen++; try { this.source?.stop(); } catch { /* already stopped */ } this.source = null; }

  private async fetchChunk(text: string, speed: number): Promise<AudioBuffer> {
    const { audio } = this.kind === 'elevenlabs'
      ? await api.tts(text, this.pref.elevenVoice, speed, { engine: 'elevenlabs', lang: this.lang, model: this.pref.elevenModel })
      : await api.tts(text, this.pref.naturalVoice, speed);
    return audioContext().decodeAudioData(audio);
  }

  /** Throws if the very first chunk can't be synthesised, so the caller can fall back to device speech. */
  async speak(text: string, onLevel: (v: number) => void): Promise<void> {
    const my = ++this.gen;
    const chunks = splitForSpeech(text);
    if (!chunks.length) return;
    // ElevenLabs voices keep their natural pitch; the cute pitch shift only applies to the local voices.
    const { synthSpeed, playbackRate } = this.kind === 'elevenlabs' ? { synthSpeed: this.pref.rate, playbackRate: 1 } : naturalPlayback(this.pref.rate, this.pref.pitch);
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
export function engineFor(pref: VoicePref, lang: string, cfg: VoiceConfig | null): TtsEngine {
  return chooseTtsEngine(pref.provider, lang, { elevenlabs: !!cfg?.elevenlabs?.configured, natural: !!cfg?.natural.available });
}
export function createTTS(pref: VoicePref, lang: string, cfg: VoiceConfig | null): TTSProvider {
  const e = engineFor(pref, lang, cfg);
  return e === 'device' ? new DeviceTTS(pref, lang) : new ServerTTS(pref, e, lang);
}

/** If ElevenLabs fails (quota, network), try the local natural voice for English, then the device voice. */
async function speakWithFallback(p: TTSProvider, pref: VoicePref, lang: string, cfg: VoiceConfig | null, text: string, onLevel: (v: number) => void): Promise<TtsEngine> {
  try {
    await p.speak(text, onLevel);
    return p.kind;
  } catch {
    if (p.kind === 'elevenlabs' && cfg?.natural.available && lang === 'en') {
      try { await new ServerTTS(pref, 'natural', lang).speak(text, onLevel); return 'natural'; } catch { /* fall through */ }
    }
    await new DeviceTTS(pref, lang).speak(text, onLevel);
    return 'device';
  }
}

/** One-off voice preview (avatar page, onboarding). */
export async function previewVoice(pref: VoicePref, lang: string, text: string, onLevel: (v: number) => void = () => {}): Promise<TtsEngine> {
  unlockAudio();
  const cfg = await loadVoiceConfig();
  return speakWithFallback(createTTS(pref, lang, cfg), pref, lang, cfg, text, onLevel);
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
      // Server voice unavailable right now (quota, model still downloading…): fall back gracefully.
      await speakWithFallback(p, pref, lang, cfg, text, (v) => { mouth.current = v; });
    } finally {
      setSpeaking(false);
      mouth.current = 0;
    }
  }, [pref, lang, cfg]);
  const stop = useCallback(() => { provider.current?.stop(); window.speechSynthesis?.cancel(); setSpeaking(false); mouth.current = 0; }, []);
  return { speak, stop, speaking, mouth, engine: provider.current?.kind ?? engineFor(pref, lang, cfg) };
}

/** Clips shorter than this are a tap, not speech: don't send them for transcription. */
const MIN_CLIP_MS = 250;

interface ListenSession {
  /** Stops capturing and resolves with the transcript ('' when nothing was said). */
  finish(): Promise<string>;
  /** Tears everything down without transcribing. */
  abort(): void;
}

/** 24 kHz PCM capture via the AudioWorklet; the realtime transcriber only drives live captions. */
async function pcmSession(stream: MediaStream, lang: string, onPartial: (t: string) => void, onLevel: (v: number) => void): Promise<ListenSession> {
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule('/pcm-worklet.js');
  } catch (e) {
    void ctx.close().catch(() => {});
    throw e;
  }
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-worklet');
  // Every frame is kept from the very first one, so nothing said while the socket connects is lost.
  const frames: ArrayBuffer[] = [];
  const live = { final: '', current: '' };
  const liveText = () => [live.final, live.current].filter(Boolean).join(' ').trim();
  let ws: WebSocket | null = null;
  try {
    ws = new WebSocket(API_URL.replace(/^http/, 'ws') + '/v1/voice/stream');
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { for (const f of frames) ws?.send(f); };
    ws.onmessage = (m) => {
      let e: { type?: string; text?: string; final?: boolean };
      try { e = JSON.parse(String(m.data)); } catch { return; }
      if (e.type !== 'transcript' || !e.text) return;
      if (e.final) { live.final += (live.final ? ' ' : '') + e.text; live.current = ''; } else live.current = e.text;
      onPartial(liveText());
    };
    ws.onerror = () => { /* captions are optional; the clip is still transcribed */ };
  } catch { ws = null; }
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
    frames.push(e.data.pcm);
    onLevel(rmsToLevel(e.data.rms));
    if (ws?.readyState === WebSocket.OPEN) ws.send(e.data.pcm);
  };
  src.connect(node);
  const teardown = () => {
    try { src.disconnect(); node.disconnect(); } catch { /* gone */ }
    node.port.onmessage = null;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };
  return {
    abort() { teardown(); try { ws?.close(); } catch { /* gone */ } },
    async finish() {
      teardown();
      // Let the realtime transcriber flush its last words.
      if (ws?.readyState === WebSocket.OPEN) {
        const sock = ws;
        sock.send(JSON.stringify({ type: 'endStream' }));
        await new Promise((r) => { sock.onclose = r; setTimeout(r, 1200); });
      }
      try { ws?.close(); } catch { /* gone */ }
      if (frames.length * FRAME_MS < MIN_CLIP_MS) return liveText();
      // The file transcriber takes a language hint, so it is the most accurate for every language.
      try {
        const { text } = await api.transcribe(toBase64(pcmToWav(frames)), 'audio/wav', lang);
        return text.trim() || liveText();
      } catch (e) {
        const fallback = liveText();
        if (fallback) return fallback;
        throw e;
      }
    },
  };
}

/** Fallback for browsers without AudioWorklet: record a compressed clip and let the server convert it. */
function recorderSession(stream: MediaStream, lang: string, onLevel: (v: number) => void): ListenSession {
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const startedAt = performance.now();
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start();
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
      onLevel(Math.min(1, peak * 2));
      meterRaf = requestAnimationFrame(meter);
    };
    meter();
  } catch { /* metering is optional */ }
  const teardown = () => {
    cancelAnimationFrame(meterRaf);
    try { meterSrc?.disconnect(); } catch { /* gone */ }
    stream.getTracks().forEach((t) => t.stop());
  };
  return {
    abort() { try { rec.stop(); } catch { /* not recording */ } teardown(); },
    async finish() {
      await new Promise<void>((r) => { if (rec.state === 'inactive') return r(); rec.onstop = () => r(); rec.stop(); });
      teardown();
      if (performance.now() - startedAt < MIN_CLIP_MS || !chunks.length) return '';
      const mime = rec.mimeType || chunks[0]!.type || 'audio/webm';
      const buf = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer());
      const { text } = await api.transcribe(toBase64(buf), mime, lang);
      return text.trim();
    },
  };
}

/** Hold-to-talk recorder with live transcripts. */
export function useListener(lang: string) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [level, setLevel] = useState(0);
  // The session being opened (getUserMedia can wait on a permission prompt), so a quick release still stops it.
  const opening = useRef<Promise<ListenSession | null> | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const start = useCallback(async () => {
    if (opening.current) return;
    setPartial('');
    setListening(true);
    const p = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      try {
        return await pcmSession(stream, langRef.current, setPartial, setLevel);
      } catch {
        return recorderSession(stream, langRef.current, setLevel);
      }
    })();
    opening.current = p;
    try {
      await p;
    } catch (e) {
      if (opening.current === p) opening.current = null;
      setListening(false);
      throw e;
    }
  }, []);

  const stop = useCallback(async (): Promise<string> => {
    const p = opening.current;
    opening.current = null;
    setListening(false);
    setLevel(0);
    if (!p) return '';
    const session = await p.catch(() => null);
    return session ? session.finish() : '';
  }, []);

  // Never leave the microphone open when the page goes away.
  useEffect(() => () => {
    const p = opening.current;
    opening.current = null;
    void p?.then((s) => s?.abort()).catch(() => {});
  }, []);

  return { start, stop, listening, partial, level };
}
