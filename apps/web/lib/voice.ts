'use client';
/**
 * Voice providers (web):
 *  - STT: realtime streaming (AudioWorklet → API WS proxy → Meta muse-voice-transcribe-1.0); falls back to recording a
 *    clip and POSTing it for file transcription.
 *  - TTS: on-device Web Speech API by default (Model API has no TTS); optional server TTS (openai-compatible) with
 *    amplitude-driven lip-sync via an AnalyserNode.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePref } from '@muse/core/avatar';
import { api, API_URL } from './api';

export interface TTSProvider { speak(text: string, onLevel: (v: number) => void): Promise<void>; stop(): void }

export class DeviceTTS implements TTSProvider {
  constructor(private pref: VoicePref, private lang: string) {}
  stop() { window.speechSynthesis?.cancel(); }
  speak(text: string, onLevel: (v: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g, ''));
      u.lang = this.lang;
      u.rate = this.pref.rate;
      u.pitch = this.pref.pitch;
      const v = synth.getVoices().find((x) => x.voiceURI === this.pref.voiceId);
      if (v) u.voice = v;
      // Lip-sync: pulse the mouth on word boundaries, with a gentle decay between them.
      let level = 0;
      const timer = setInterval(() => { level *= 0.75; onLevel(level); }, 50);
      u.onboundary = () => { level = 0.9; };
      u.onstart = () => { level = 0.6; };
      const done = () => { clearInterval(timer); onLevel(0); resolve(); };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });
  }
}

export class ServerTTS implements TTSProvider {
  private audio?: HTMLAudioElement;
  constructor(private voice: string) {}
  stop() { this.audio?.pause(); }
  async speak(text: string, onLevel: (v: number) => void): Promise<void> {
    const r = await fetch(`${API_URL}/v1/voice/tts`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-muse-client': 'web' }, body: JSON.stringify({ text, voice: this.voice }) });
    if (!r.ok) throw new Error('server tts unavailable');
    const url = URL.createObjectURL(await r.blob());
    const audio = (this.audio = new Audio(url));
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaElementSource(audio).connect(an);
    an.connect(ctx.destination);
    const data = new Uint8Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(data);
      let peak = 0;
      for (const d of data) peak = Math.max(peak, Math.abs(d - 128) / 128);
      onLevel(Math.min(1, peak * 2.2));
      raf = requestAnimationFrame(tick);
    };
    await audio.play();
    tick();
    await new Promise<void>((res) => { audio.onended = () => res(); audio.onerror = () => res(); });
    cancelAnimationFrame(raf);
    onLevel(0);
    void ctx.close();
    URL.revokeObjectURL(url);
  }
}

export function useSpeech(pref: VoicePref, lang: string) {
  const mouth = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const provider = useRef<TTSProvider | null>(null);
  useEffect(() => { provider.current = pref.provider === 'server' ? new ServerTTS(pref.voiceId) : new DeviceTTS(pref, lang); }, [pref, lang]);
  const speak = useCallback(async (text: string) => {
    if (!provider.current) return;
    setSpeaking(true);
    try {
      await provider.current.speak(text.slice(0, 1200), (v) => { mouth.current = v; });
    } catch {
      await new DeviceTTS(pref, lang).speak(text, (v) => { mouth.current = v; });
    } finally {
      setSpeaking(false);
    }
  }, [pref, lang]);
  const stop = useCallback(() => { provider.current?.stop(); setSpeaking(false); mouth.current = 0; }, []);
  return { speak, stop, speaking, mouth };
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
    stopRef.current = async () => {
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
