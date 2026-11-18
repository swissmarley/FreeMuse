/**
 * Local neural text-to-speech (Kokoro-82M, Apache-2.0) running inside the API process.
 * Sounds natural, is free, and the text never leaves your server. The model (~90 MB, q8) is downloaded from
 * Hugging Face on first use and cached in TTS_CACHE_DIR. Synthesis is serialised so it can't starve the API.
 */
import { DEFAULT_NATURAL_VOICE, isNaturalVoiceId, speakableText } from '@muse/core/voice';
import { log } from '@muse/runtime';

type Kokoro = { generate(text: string, o: { voice?: string; speed?: number }): Promise<{ audio: Float32Array; sampling_rate: number }> };

export type LocalTtsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LocalTtsOptions {
  modelId: string;
  dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
  cacheDir?: string;
}

/** Encode mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

export class LocalTTS {
  private engine: Promise<Kokoro> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, Buffer>();
  status: LocalTtsStatus = 'idle';
  error?: string;

  constructor(private opts: LocalTtsOptions) {}

  /** Start loading the model (idempotent). Resolves when ready; rejects (and allows a later retry) on failure. */
  load(): Promise<Kokoro> {
    if (this.engine) return this.engine;
    this.status = 'loading';
    this.engine = (async () => {
      const tf = await import('@huggingface/transformers');
      if (this.opts.cacheDir) tf.env.cacheDir = this.opts.cacheDir;
      const { KokoroTTS } = await import('kokoro-js');
      const started = Date.now();
      const tts = await KokoroTTS.from_pretrained(this.opts.modelId, { dtype: this.opts.dtype, device: 'cpu' });
      log.info({ ms: Date.now() - started, model: this.opts.modelId }, 'natural voice model ready');
      this.status = 'ready';
      return tts as unknown as Kokoro;
    })();
    this.engine.catch((e: Error) => {
      this.status = 'error';
      this.error = e.message;
      this.engine = null;
      log.warn({ err: e.message }, 'natural voice model failed to load; clients fall back to device voices');
    });
    return this.engine;
  }

  /** Synthesise speech as a WAV file. */
  async synth(text: string, voice: string, speed: number): Promise<Buffer> {
    const clean = speakableText(text).slice(0, 600);
    if (!clean) throw new Error('nothing to say');
    const v = isNaturalVoiceId(voice) ? voice : DEFAULT_NATURAL_VOICE;
    const sp = Math.min(2, Math.max(0.5, Number.isFinite(speed) ? speed : 1));
    const key = `${v}|${sp.toFixed(2)}|${clean}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const engine = await this.load();
    const job = this.queue.then(async () => {
      const audio = await engine.generate(clean, { voice: v, speed: sp });
      return encodeWav(audio.audio, audio.sampling_rate);
    });
    this.queue = job.catch(() => undefined);
    const wav = await job;
    this.cache.set(key, wav);
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    return wav;
  }
}
