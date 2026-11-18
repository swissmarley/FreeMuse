/**
 * Voice catalogue + helpers shared by web, mobile and the API.
 *
 * Two ways to speak:
 *  - "Natural" voices: a small neural model (Kokoro, Apache-2.0) that runs locally inside the API, so it sounds human,
 *    costs nothing, and the text never leaves your server. English only.
 *  - Device voices: the OS speech engine. Quality varies a lot (Linux eSpeak sounds robotic), so we rank the voices and
 *    pick the most natural one for the user's language instead of the system default.
 */

export interface NaturalVoice {
  id: string;
  label: string;
  description: string;
  /** BCP-47 language prefix the voice speaks. */
  lang: 'en';
  gender: 'female' | 'male';
}

/** Ordered by how cute/clear they sound for an assistant character. The first one is the default. */
export const NATURAL_VOICES: readonly NaturalVoice[] = [
  { id: 'af_heart', label: 'Heart', description: 'Warm, sweet and clear (recommended)', lang: 'en', gender: 'female' },
  { id: 'af_bella', label: 'Bella', description: 'Bright and bubbly', lang: 'en', gender: 'female' },
  { id: 'af_nicole', label: 'Nicole', description: 'Soft and gentle, a little whispery', lang: 'en', gender: 'female' },
  { id: 'af_sky', label: 'Sky', description: 'Light and youthful', lang: 'en', gender: 'female' },
  { id: 'af_nova', label: 'Nova', description: 'Friendly and upbeat', lang: 'en', gender: 'female' },
  { id: 'bf_emma', label: 'Emma', description: 'British, cheerful', lang: 'en', gender: 'female' },
  { id: 'bf_isabella', label: 'Isabella', description: 'British, calm', lang: 'en', gender: 'female' },
  { id: 'am_puck', label: 'Puck', description: 'Playful and cheeky', lang: 'en', gender: 'male' },
  { id: 'am_michael', label: 'Michael', description: 'Calm and kind', lang: 'en', gender: 'male' },
] as const;

export const DEFAULT_NATURAL_VOICE = 'af_heart';
export const NATURAL_VOICE_LANGS = ['en'] as const;

export function isNaturalVoiceId(id: string): boolean {
  return NATURAL_VOICES.some((v) => v.id === id);
}

/** True if natural (server) voices can speak this UI language. */
export function naturalVoiceSpeaks(lang: string): boolean {
  return (NATURAL_VOICE_LANGS as readonly string[]).includes(lang.slice(0, 2).toLowerCase());
}

/**
 * Natural voices change pitch by playing slightly faster with pitch correction off; we synthesise slower by the same
 * factor so the speaking speed stays what the user picked. Pitch is clamped so it stays cute, not chipmunk.
 */
export function naturalPlayback(rate: number, pitch: number): { synthSpeed: number; playbackRate: number } {
  const p = Math.min(1.25, Math.max(0.85, pitch || 1));
  const r = Math.min(2, Math.max(0.5, rate || 1));
  return { synthSpeed: Math.min(2, Math.max(0.5, r / p)), playbackRate: p };
}

/** Remove markdown, links and emoji so speech sounds natural. */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*_#`>|~]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([!?.,;:])/g, '$1')
    .replace(/([^.!?:\s])\s*\n{2,}/g, '$1.\n')
    .trim();
}

/**
 * Split text into short speakable chunks (sentences, merged up to ~maxLen) so the first one can start playing
 * while the rest is still being synthesised.
 */
export function splitForSpeech(text: string, maxLen = 220): string[] {
  const clean = speakableText(text);
  if (!clean) return [];
  const sentences = clean.match(/[^.!?。\n]+[.!?。]*[\s\n]*|[\n]+/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  const out: string[] = [];
  let cur = '';
  for (let s of sentences) {
    while (s.length > maxLen) {
      const cut = s.lastIndexOf(' ', maxLen) > maxLen / 2 ? s.lastIndexOf(' ', maxLen) : maxLen;
      if (cur) { out.push(cur); cur = ''; }
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    // Keep the very first chunk short so speech starts quickly.
    const limit = out.length === 0 ? Math.min(maxLen, 120) : maxLen;
    if (cur && (cur + ' ' + s).length > limit) { out.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out.filter((c) => /[\p{L}\p{N}]/u.test(c));
}

// ---------------------------------------------------------------------------------------------------------------
// Device voice ranking
// ---------------------------------------------------------------------------------------------------------------

export interface DeviceVoiceLike {
  id: string;
  name: string;
  lang: string;
  /** expo-speech reports 'Enhanced' for higher quality voices. */
  quality?: string;
  /** Web Speech: false for cloud voices (which are usually the natural ones). */
  localService?: boolean;
}

/** macOS/iOS novelty voices and the like: technically voices, but not something you want to listen to. */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|pipe organ|organ|trinoids|whisper|zarvox|wobble|superstar|jester|fred|ralph|kathy|grandma|grandpa|rocko|shelley|eddy|reed|sandy|flo)\b/i;
const ROBOTIC = /espeak|e-speak|mbrola|festival|pico|\bsam\b/i;
const NATURAL = /natural|neural|premium|enhanced|online|wavenet|studio|journey|siri|-network/i;
/** Pleasant, clear voices that ship with common systems. */
const NICE = /\b(samantha|ava|allison|susan|zoe|karen|moira|tessa|serena|jenny|aria|ana|emma|michelle|sonia|libby|natasha|clara|joanna|salli|kendra|ivy|google (us|uk) english|anna|petra|helena|marlene|katja|amélie|amelie|audrey|aurelie|alice|federica|elsa|isabella|paulina|monica|mónica|marisol|elvira|lucia)\b/i;

export function scoreDeviceVoice(v: DeviceVoiceLike, lang: string): number {
  const want = lang.toLowerCase();
  const vl = (v.lang || '').toLowerCase().replace('_', '-');
  let s = 0;
  if (vl === want) s += 100;
  else if (vl.slice(0, 2) === want.slice(0, 2)) s += 80;
  else return -1000;
  const name = v.name || v.id;
  if (NATURAL.test(name) || NATURAL.test(v.id)) s += 60;
  if (v.quality && /enhanced|premium|high/i.test(v.quality)) s += 45;
  if (/google/i.test(name)) s += 35;
  if (NICE.test(name)) s += 25;
  if (v.localService === false) s += 10;
  if (/compact/i.test(name) || /compact/i.test(v.id)) s -= 25;
  if (NOVELTY.test(name)) s -= 200;
  if (ROBOTIC.test(name) || ROBOTIC.test(v.id)) s -= 120;
  return s;
}

/** Voices for this language, best first. */
export function rankDeviceVoices<T extends DeviceVoiceLike>(voices: T[], lang: string): T[] {
  return voices
    .map((v) => ({ v, s: scoreDeviceVoice(v, lang) }))
    .filter((x) => x.s > -50) // drops other languages and novelty voices; keeps robotic engines as a last resort
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

/** Show a ★ next to voices that are likely to sound natural. */
export function isNiceDeviceVoice(v: DeviceVoiceLike, lang: string): boolean {
  return scoreDeviceVoice(v, lang) >= 140;
}

/** The voice to use when the user hasn't picked one (or their pick isn't installed on this device). */
export function pickDeviceVoice<T extends DeviceVoiceLike>(voices: T[], lang: string, preferredId?: string): T | undefined {
  if (preferredId) {
    const exact = voices.find((v) => v.id === preferredId);
    if (exact) return exact;
  }
  return rankDeviceVoices(voices, lang)[0];
}

// ---------------------------------------------------------------------------------------------------------------
// ElevenLabs (professional voices; the user brings their own API key, the free plan works)
// ---------------------------------------------------------------------------------------------------------------

export interface ElevenModel { id: string; labelKey: 'elModelFlash' | 'elModelMultilingual' | 'elModelTurbo'; languageCode: boolean }

/** Flash v2.5 is the default: lowest latency (best for calls), half the credits, 32 languages incl. it/de/fr/es. */
export const ELEVEN_MODELS: readonly ElevenModel[] = [
  { id: 'eleven_flash_v2_5', labelKey: 'elModelFlash', languageCode: true },
  { id: 'eleven_turbo_v2_5', labelKey: 'elModelTurbo', languageCode: true },
  { id: 'eleven_multilingual_v2', labelKey: 'elModelMultilingual', languageCode: false },
] as const;
export const DEFAULT_ELEVEN_MODEL = 'eleven_flash_v2_5';

export function isElevenModel(id: string): boolean {
  return ELEVEN_MODELS.some((m) => m.id === id);
}

/**
 * Default ElevenLabs voices that every account has (usable on the free plan through the API). "Jessica" (playful,
 * bright, warm) fits a cute assistant character; all of them speak every supported language with the
 * multilingual models.
 */
export const ELEVEN_DEFAULT_VOICES: readonly { id: string; name: string; gender: 'female' | 'male' }[] = [
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female' },
  { id: 'pFZP5JQG7iQjIQuC4Bdp', name: 'Lily', gender: 'female' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'female' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female' },
  { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', gender: 'female' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'male' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male' },
] as const;
export const DEFAULT_ELEVEN_VOICE = 'cgSgspJ2msm6clMCkdW9';

export interface ElevenVoice { id: string; name: string; category: string; description: string; gender?: string; accent?: string; previewUrl?: string }

/** ElevenLabs voice ids are 20 alphanumeric characters. */
export function isElevenVoiceId(id: string): boolean {
  return /^[A-Za-z0-9]{16,32}$/.test(id);
}

export type TtsEngine = 'elevenlabs' | 'natural' | 'device';

/**
 * Which engine speaks, given the preference, language and what the server offers:
 * ElevenLabs (when the user added a key) > local natural voice (English only) > best device voice.
 */
export function chooseTtsEngine(provider: string, lang: string, opts: { elevenlabs: boolean; natural: boolean }): TtsEngine {
  if (provider === 'device') return 'device';
  if (provider === 'elevenlabs') return opts.elevenlabs ? 'elevenlabs' : opts.natural && naturalVoiceSpeaks(lang) ? 'natural' : 'device';
  if (provider === 'server') return opts.natural ? 'natural' : opts.elevenlabs ? 'elevenlabs' : 'device';
  if (opts.elevenlabs) return 'elevenlabs';
  return opts.natural && naturalVoiceSpeaks(lang) ? 'natural' : 'device';
}

// ---------------------------------------------------------------------------------------------------------------
// Voice-call turn taking (voice activity detection), shared by web and mobile
// ---------------------------------------------------------------------------------------------------------------

/**
 * Map a loudness in dBFS to the 0..1 level scale the VAD and the avatar use (roughly -55 dB → 0, -5 dB → 1).
 * Both the web mic (RMS of each frame) and the phone recorder (metering) report on this scale.
 */
export function dbToLevel(db: number | undefined): number {
  return typeof db === 'number' && Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 55) / 50)) : 0;
}

/** RMS amplitude (0..1) → level. */
export function rmsToLevel(rms: number): number {
  return rms > 0 ? dbToLevel(20 * Math.log10(rms)) : 0;
}

export interface VadOptions {
  /** Minimum absolute level (0..1, dB-mapped) that counts as speech. */
  minLevel: number;
  /** Speech must be this much above the background noise floor (on the 0..1 scale; 0.1 ≈ 5 dB). */
  margin: number;
  /** How long speech must last before it counts (ms). */
  startMs: number;
  /** Silence after speech that ends the turn (ms). */
  endMs: number;
  /** Ignore very short blips (ms of speech in total). */
  minSpeechMs: number;
  /** A turn never lasts longer than this (ms), whatever the mic hears. */
  maxSpeechMs: number;
  /**
   * Echo guard (for barge-in while the assistant talks): remember the loudest recent level that was not a turn
   * (the assistant's own voice leaking into the mic) and require speech to be `margin` louder than that. The memory
   * fades by this much per second. Off when undefined.
   */
  holdDecayPerS?: number;
  /** After a reset, no turn can start for this long (ms), while the echo guard learns how loud the echo is. */
  graceMs?: number;
}

export const DEFAULT_VAD: VadOptions = { minLevel: 0.3, margin: 0.2, startMs: 150, endMs: 800, minSpeechMs: 300, maxSpeechMs: 30_000 };
/** While the assistant is talking, a barge-in needs to be clearly louder (its own voice may leak into the mic). */
export const BARGE_IN_VAD: VadOptions = {
  minLevel: 0.55, margin: 0.15, startMs: 400, endMs: 800, minSpeechMs: 300, maxSpeechMs: 30_000, holdDecayPerS: 0.08, graceMs: 900,
};

export type VadEvent = 'speech-start' | 'speech-end' | 'blip' | null;

/** How fast the noise floor follows a quieter background (per second, as a fraction of the gap). */
const FLOOR_FALL_PER_S = 6;
/** How fast it creeps up towards a louder background (level units per second). Always running, even mid-turn, so
 *  a steady noise (fan, traffic, a raised mic gain) can never hold a turn open: it ends up under the floor. */
const FLOOR_RISE_PER_S = 0.06;

/**
 * A tiny, dependency-free voice activity detector driven by level samples (dB-mapped 0..1) with timestamps.
 * It tracks the background noise all the time, needs speech to last a moment before it starts a turn, and ends the
 * turn after a short pause, like a person on the phone.
 */
export class Vad {
  floor = 0.15;
  speaking = false;
  private aboveSince: number | null = null;
  private lastVoice = 0;
  private speechStart = 0;
  private lastT: number | null = null;
  /** Loudest recent non-turn level (echo guard). */
  hold = 0;
  private armedAt: number | null = null;
  constructor(public opts: VadOptions = DEFAULT_VAD) {}

  threshold(): number {
    const base = this.opts.holdDecayPerS === undefined ? this.floor : Math.max(this.floor, this.hold);
    return Math.max(this.opts.minLevel, base + this.opts.margin);
  }

  /** Forget the current turn (the noise floor is kept). */
  reset() {
    this.speaking = false;
    this.aboveSince = null;
    this.hold = 0;
    this.armedAt = null;
  }

  /** Learn the background without detecting anything (e.g. while the mic is muted for the call). */
  observe(level: number, now: number) {
    const dt = this.lastT === null ? 0.08 : Math.min(1, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    if (level < this.floor) this.floor -= (this.floor - level) * Math.min(1, FLOOR_FALL_PER_S * dt);
    else this.floor = Math.min(level, this.floor + FLOOR_RISE_PER_S * dt);
    this.floor = Math.min(0.85, Math.max(0, this.floor));
  }

  push(level: number, now: number): VadEvent {
    this.armedAt ??= now;
    const dt = this.lastT === null ? 0.08 : Math.min(1, Math.max(0, (now - this.lastT) / 1000));
    const loud = level >= this.threshold();
    this.observe(level, now);
    const grace = now - this.armedAt < (this.opts.graceMs ?? 0);
    if (this.opts.holdDecayPerS !== undefined && !this.speaking && (!loud || grace)) {
      this.hold = Math.max(level, this.hold - this.opts.holdDecayPerS * dt);
    }
    if (grace) return null;
    if (this.speaking && now - this.speechStart >= this.opts.maxSpeechMs) {
      this.reset();
      return 'speech-end';
    }
    if (loud) {
      this.lastVoice = now;
      if (!this.speaking) {
        this.aboveSince ??= now;
        if (now - this.aboveSince >= this.opts.startMs) {
          this.speaking = true;
          this.speechStart = this.aboveSince;
          return 'speech-start';
        }
      }
      return null;
    }
    this.aboveSince = null;
    if (this.speaking && now - this.lastVoice >= this.opts.endMs) {
      this.speaking = false;
      return this.lastVoice - this.speechStart >= this.opts.minSpeechMs ? 'speech-end' : 'blip';
    }
    return null;
  }
}

/** Short replies the call uses while the agent works (picked so they don't repeat back to back). */
export function pickFiller(i: number): 'callFiller1' | 'callFiller2' | 'callFiller3' {
  return (['callFiller1', 'callFiller2', 'callFiller3'] as const)[i % 3]!;
}
