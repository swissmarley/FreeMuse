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
