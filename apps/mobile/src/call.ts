/**
 * Hands-free voice call engine (mobile). The phone records while you talk; a voice activity detector on the
 * recorder's level meter notices when you start and when you pause, then the clip is transcribed (with a language
 * hint) and handed to the call. While the assistant talks the mic rests (phone speakers have no echo cancellation
 * here), and tapping the character interrupts it.
 */
import { File } from 'expo-file-system';
import { setAudioModeAsync, type AudioRecorder } from 'expo-audio';
import { Vad, type VadOptions } from '@muse/core/voice';
import { api } from './api';

/** Metering is in dBFS (-160..0); map roughly -55..-5 dB to 0..1. */
export const dbToLevel = (db: number | undefined) => (typeof db === 'number' ? Math.max(0, Math.min(1, (db + 55) / 50)) : 0);
/** On the dB-mapped scale the background sits higher, so ask for a clear margin over it. */
export const MOBILE_VAD: VadOptions = { minLevel: 0.3, ratio: 1.6, startMs: 160, endMs: 900, minSpeechMs: 350 };

/** During a call, keep the audio session in play-and-record mode; route to the earpiece or the speaker. */
let callAudio: { active: boolean; earpiece: boolean } = { active: false, earpiece: false };
export function inCall() { return callAudio.active; }
export async function setCallAudio(active: boolean, earpiece = false) {
  callAudio = { active, earpiece };
  await setAudioModeAsync(active
    ? { allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: earpiece }
    : { allowsRecording: false, playsInSilentMode: true, shouldRouteThroughEarpiece: false }).catch(() => {});
}

export interface MobileCallEvents {
  level(v: number): void;
  speechStart(): void;
  utterance(text: string): void;
  blip(): void;
}

export class MobileCallMic {
  private timer: ReturnType<typeof setInterval> | null = null;
  private vad = new Vad(MOBILE_VAD);
  private startedAt = 0;
  private heard = false;
  private busy = false;
  private stopped = false;
  constructor(private recorder: AudioRecorder, private lang: string, private on: MobileCallEvents) {}

  /** Start (or restart) listening for the next thing the user says. */
  async listen(): Promise<void> {
    if (this.stopped || this.busy) return;
    await this.halt();
    await this.recorder.prepareToRecordAsync();
    this.recorder.record();
    this.vad.reset();
    this.heard = false;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), 80);
  }

  /** Stop listening and discard what was recorded. */
  async pause(): Promise<void> {
    await this.halt();
    this.on.level(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.halt();
  }

  private async halt() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { if (this.recorder.isRecording) await this.recorder.stop(); } catch { /* not recording */ }
  }

  private tick() {
    const now = Date.now();
    const level = dbToLevel(this.recorder.getStatus().metering);
    this.on.level(level);
    const ev = this.vad.push(level, now);
    if (ev === 'speech-start') { this.heard = true; this.on.speechStart(); }
    else if (ev === 'speech-end') void this.finish();
    else if (ev === 'blip') { this.heard = false; this.on.blip(); }
    // Don't let a silent recording grow forever: start a fresh one every 25 s of quiet.
    if (!this.heard && !this.vad.speaking && now - this.startedAt > 25_000) void this.listen();
    if (now - this.startedAt > 60_000) void this.finish();
  }

  private async finish() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.halt();
      const uri = this.recorder.uri;
      let text = '';
      if (uri) {
        try {
          const b64 = await new File(uri).base64();
          text = (await api.transcribe(b64, 'audio/m4a', this.lang)).text.trim();
        } catch { text = ''; }
      }
      if (!this.stopped) this.on.utterance(text);
    } finally {
      this.busy = false;
    }
  }
}
