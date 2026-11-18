/**
 * Mobile voice:
 *  - STT: push-to-talk recording (expo-audio) → server transcription (Meta muse-voice-transcribe-1.0 via the API,
 *    which converts to 24 kHz WAV), with live metering so the avatar can react to your voice.
 *  - TTS: natural neural voices synthesised by the API (Kokoro) and played with expo-audio, sentence by sentence;
 *    falls back to the most natural installed voice via expo-speech (never blindly the default compact voice).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { AudioModule, createAudioPlayer, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type AudioPlayer } from 'expo-audio';
import type { VoicePref } from '@muse/core/avatar';
import type { VoiceConfig } from '@muse/core/client';
import { type DeviceVoiceLike, naturalPlayback, naturalVoiceSpeaks, pickDeviceVoice, rankDeviceVoices, speakableText, splitForSpeech } from '@muse/core/voice';
import { api } from './api';

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

// ---------- device voices ----------
let voicesPromise: Promise<DeviceVoiceLike[]> | null = null;
export function deviceVoices(): Promise<DeviceVoiceLike[]> {
  if (!voicesPromise) {
    voicesPromise = Speech.getAvailableVoicesAsync()
      .then((vs) => vs.map((v) => ({ id: v.identifier, name: v.name, lang: v.language, quality: String(v.quality) })))
      .catch(() => []);
  }
  return voicesPromise;
}
export async function rankedDeviceVoices(lang: string) { return rankDeviceVoices(await deviceVoices(), lang); }

type Level = (v: number) => void;
interface Engine { kind: 'natural' | 'device'; speak(text: string, onLevel: Level): Promise<void>; stop(): void }

class DeviceEngine implements Engine {
  readonly kind = 'device' as const;
  constructor(private pref: VoicePref, private lang: string) {}
  stop() { void Speech.stop(); }
  async speak(text: string, onLevel: Level) {
    const voice = pickDeviceVoice(await deviceVoices(), this.lang, this.pref.voiceId);
    let level = 0;
    const timer = setInterval(() => { level *= 0.75; onLevel(level); }, 50);
    await new Promise<void>((resolve) => {
      const done = () => { clearInterval(timer); onLevel(0); resolve(); };
      Speech.speak(speakableText(text).slice(0, 1500), {
        language: voice?.lang ?? this.lang, rate: this.pref.rate, pitch: this.pref.pitch, voice: voice?.id,
        onBoundary: () => { level = 0.9; },
        onStart: () => { level = 0.6; },
        onDone: done, onStopped: done, onError: done,
      });
    });
  }
}

class NaturalEngine implements Engine {
  readonly kind = 'natural' as const;
  private gen = 0;
  private player: AudioPlayer | null = null;
  constructor(private pref: VoicePref) {}
  stop() { this.gen++; try { this.player?.pause(); this.player?.remove(); } catch { /* gone */ } this.player = null; }

  private async fetchChunk(text: string, speed: number, n: number): Promise<string> {
    const { audio } = await api.tts(text, this.pref.naturalVoice, speed);
    const f = new File(Paths.cache, `freemuse-tts-${n % 4}.wav`);
    if (f.exists) f.delete();
    f.create();
    await f.write(new Uint8Array(audio));
    return f.uri;
  }

  async speak(text: string, onLevel: Level) {
    const my = ++this.gen;
    const chunks = splitForSpeech(text);
    if (!chunks.length) return;
    const { synthSpeed, playbackRate } = naturalPlayback(this.pref.rate, this.pref.pitch);
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    let next: Promise<string> | null = this.fetchChunk(chunks[0]!, synthSpeed, 0);
    for (let i = 0; i < chunks.length; i++) {
      let uri: string;
      try { uri = await next!; } catch (e) { if (i === 0) throw e; break; }
      if (my !== this.gen) return;
      next = i + 1 < chunks.length ? this.fetchChunk(chunks[i + 1]!, synthSpeed, i + 1) : null;
      next?.catch(() => {});
      await new Promise<void>((resolve) => {
        const p = (this.player = createAudioPlayer(uri));
        p.shouldCorrectPitch = false;
        p.setPlaybackRate(playbackRate);
        // Lip-sync from real audio samples where supported, otherwise a gentle "talking" wobble.
        let sampled = false;
        if (p.isAudioSamplingSupported) {
          try {
            p.setAudioSamplingEnabled(true);
            p.addListener('audioSampleUpdate', (s) => {
              sampled = true;
              let peak = 0;
              for (const v of s.channels[0]?.frames ?? []) peak = Math.max(peak, Math.abs(v));
              onLevel(Math.min(1, peak * 2.4));
            });
          } catch { /* no sampling */ }
        }
        const t0 = Date.now();
        const wobble = setInterval(() => { if (!sampled) onLevel(0.35 + 0.35 * Math.abs(Math.sin((Date.now() - t0) / 90))); }, 60);
        const finish = () => { clearInterval(wobble); onLevel(0); try { p.remove(); } catch { /* gone */ } resolve(); };
        p.addListener('playbackStatusUpdate', (st) => { if (st.didJustFinish) finish(); });
        const guard = setInterval(() => { if (my !== this.gen) { clearInterval(guard); finish(); } }, 150);
        p.play();
      });
      if (my !== this.gen) return;
    }
  }
}

function createEngine(pref: VoicePref, lang: string, cfg: VoiceConfig | null): Engine {
  const natural = !!cfg?.natural.available && pref.provider !== 'device' && (pref.provider === 'server' || naturalVoiceSpeaks(lang));
  return natural ? new NaturalEngine(pref) : new DeviceEngine(pref, lang);
}

/** One-off preview (avatar screen, onboarding). */
export async function previewVoice(pref: VoicePref, lang: string, text: string, onLevel: Level = () => {}): Promise<'natural' | 'device'> {
  const e = createEngine(pref, lang, await loadVoiceConfig());
  try { await e.speak(text, onLevel); return e.kind; } catch { await new DeviceEngine(pref, lang).speak(text, onLevel); return 'device'; }
}

export function useSpeech(pref: VoicePref, lang: string) {
  const mouth = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const cfg = useVoiceConfig();
  const engine = useRef<Engine | null>(null);
  useEffect(() => { engine.current?.stop(); engine.current = createEngine(pref, lang, cfg); }, [pref, lang, cfg]);
  const speak = useCallback(async (text: string) => {
    const e = engine.current ?? createEngine(pref, lang, cfg);
    engine.current = e;
    e.stop();
    setSpeaking(true);
    try {
      await e.speak(text, (v) => { mouth.current = v; });
    } catch {
      await new DeviceEngine(pref, lang).speak(text, (v) => { mouth.current = v; });
    } finally {
      mouth.current = 0;
      setSpeaking(false);
    }
  }, [pref, lang, cfg]);
  const stop = useCallback(() => { engine.current?.stop(); void Speech.stop(); mouth.current = 0; setSpeaking(false); }, []);
  return { speak, stop, speaking, mouth, engine: engine.current?.kind ?? (cfg?.natural.available ? 'natural' : 'device') };
}

export function useListener(lang: string) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rs = useAudioRecorderState(recorder, 80);
  const [listening, setListening] = useState(false);
  // metering is in dBFS (-160..0); map roughly -50..-5 dB to 0..1
  const level = listening && typeof rs.metering === 'number' ? Math.max(0, Math.min(1, (rs.metering + 50) / 45)) : 0;
  const start = useCallback(async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) throw new Error('Microphone permission denied');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setListening(true);
  }, [recorder]);
  const stop = useCallback(async (): Promise<string> => {
    setListening(false);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!recorder.uri) return '';
    const b64 = await new File(recorder.uri).base64();
    const { text } = await api.transcribe(b64, 'audio/m4a');
    return text;
  }, [recorder]);
  return { start, stop, listening, level, lang };
}
