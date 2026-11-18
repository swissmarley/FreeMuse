/**
 * ElevenLabs text-to-speech with the user's own API key (the free plan works).
 *  - The key is stored encrypted in the user's vault (kind "apikey") and never sent back to clients.
 *  - Speech is synthesised server-side and streamed to the app as MP3, so the key never leaves the server.
 */
import { DEFAULT_ELEVEN_MODEL, DEFAULT_ELEVEN_VOICE, ELEVEN_DEFAULT_VOICES, ELEVEN_MODELS, type ElevenVoice, isElevenVoiceId, speakableText } from '@muse/core/voice';
import type { Vault } from './vault.js';

export const ELEVEN_SERVICE = 'elevenlabs';

export class ElevenError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function keyHint(key: string): string {
  return key.length > 8 ? `…${key.slice(-4)}` : '…';
}

/** A plausible ElevenLabs key: "sk_" + hex (current format) or a 32-char hex string (older keys). */
export function looksLikeElevenKey(key: string): boolean {
  return /^(sk_[A-Za-z0-9]{20,100}|[a-f0-9]{32})$/.test(key);
}

async function errorFrom(r: Response): Promise<ElevenError> {
  let status = '';
  let message = '';
  try {
    const j = (await r.json()) as { detail?: { status?: string; message?: string } | string };
    if (typeof j.detail === 'string') message = j.detail;
    else { status = j.detail?.status ?? ''; message = j.detail?.message ?? ''; }
  } catch { /* not json */ }
  if (/quota|credits|limit_reached/i.test(status + message)) return new ElevenError(402, 'elevenlabs_quota', 'Your ElevenLabs quota is used up');
  if (status === 'invalid_api_key' || (r.status === 401 && !/permission/i.test(status + message))) return new ElevenError(401, 'elevenlabs_invalid_key', 'ElevenLabs did not accept this API key');
  if (/permission/i.test(status + message)) return new ElevenError(403, 'elevenlabs_permissions', 'This ElevenLabs key is missing a permission (allow Text to Speech and Voices read)');
  if (/free_users_not_allowed|paid|subscription/i.test(status + message)) return new ElevenError(402, 'elevenlabs_plan', 'This voice needs a paid ElevenLabs plan. Pick one of the default voices.');
  if (r.status === 429) return new ElevenError(429, 'elevenlabs_busy', 'ElevenLabs is busy, please try again');
  return new ElevenError(502, 'elevenlabs_failed', `ElevenLabs error ${r.status}${message ? `: ${message.slice(0, 120)}` : ''}`);
}

export function defaultVoices(): ElevenVoice[] {
  return ELEVEN_DEFAULT_VOICES.map((v) => ({ id: v.id, name: v.name, category: 'premade', description: '', gender: v.gender }));
}

export class ElevenLabs {
  /** Decrypted keys, briefly cached so speaking sentence by sentence doesn't hit the vault every time. */
  private cache = new Map<string, { key: string | null; at: number }>();
  constructor(private baseUrl: string, private vault: Vault, private fetchImpl: typeof fetch = fetch) {}

  async key(userId: string): Promise<string | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.key;
    const id = await this.vault.findId(userId, 'apikey', ELEVEN_SERVICE);
    const item = id ? await this.vault.get<{ apiKey: string }>(userId, id) : null;
    const key = item?.secret.apiKey ?? null;
    this.cache.set(userId, { key, at: Date.now() });
    return key;
  }

  async status(userId: string): Promise<{ configured: boolean; keyHint: string | null }> {
    const k = await this.key(userId);
    return { configured: !!k, keyHint: k ? keyHint(k) : null };
  }

  /** Check the key with ElevenLabs, then store it encrypted. Returns the account's voices. */
  async save(userId: string, apiKey: string): Promise<ElevenVoice[]> {
    let voices: ElevenVoice[];
    try {
      voices = await this.voices(apiKey);
    } catch (e) {
      // A key restricted to Text to Speech can't list voices: it still works with the default voices.
      if (e instanceof ElevenError && e.code === 'elevenlabs_permissions') voices = defaultVoices();
      else throw e;
    }
    await this.vault.put(userId, 'apikey', ELEVEN_SERVICE, 'default', { apiKey });
    this.cache.delete(userId);
    return voices;
  }

  async remove(userId: string): Promise<void> {
    const id = await this.vault.findId(userId, 'apikey', ELEVEN_SERVICE);
    if (id) await this.vault.remove(userId, id);
    this.cache.delete(userId);
  }

  async voices(apiKey: string): Promise<ElevenVoice[]> {
    const r = await this.fetchImpl(`${this.baseUrl}/v1/voices`, { headers: { 'xi-api-key': apiKey, accept: 'application/json' } });
    if (!r.ok) throw await errorFrom(r);
    const j = (await r.json()) as { voices?: { voice_id: string; name: string; category?: string; description?: string; preview_url?: string; labels?: Record<string, string> }[] };
    const list = (j.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category ?? 'premade',
      description: v.labels?.description ?? v.description ?? v.labels?.descriptive ?? '',
      gender: v.labels?.gender,
      accent: v.labels?.accent,
      previewUrl: v.preview_url,
    }));
    // Default voice first, then the user's own voices, then the other default voices.
    const rank = (v: ElevenVoice) => (v.id === DEFAULT_ELEVEN_VOICE ? 0 : v.category === 'premade' ? 2 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  /** Synthesise one chunk as MP3. */
  async synth(apiKey: string, o: { text: string; voiceId?: string; model?: string; lang?: string; speed?: number }): Promise<Buffer> {
    const text = speakableText(o.text).slice(0, 1200);
    if (!text) throw new ElevenError(400, 'invalid', 'nothing to say');
    const voice = o.voiceId && isElevenVoiceId(o.voiceId) ? o.voiceId : DEFAULT_ELEVEN_VOICE;
    const model = ELEVEN_MODELS.find((m) => m.id === o.model) ?? ELEVEN_MODELS.find((m) => m.id === DEFAULT_ELEVEN_MODEL)!;
    const speed = Math.min(1.2, Math.max(0.7, Number.isFinite(o.speed) ? o.speed! : 1));
    const body: Record<string, unknown> = {
      text,
      model_id: model.id,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed },
    };
    if (model.languageCode && o.lang && /^[a-z]{2}$/.test(o.lang)) body.language_code = o.lang;
    const r = await this.fetchImpl(`${this.baseUrl}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw await errorFrom(r);
    return Buffer.from(await r.arrayBuffer());
  }
}
