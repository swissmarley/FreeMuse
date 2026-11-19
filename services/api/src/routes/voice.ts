/**
 * Voice: speech-to-text via Meta's muse-voice-transcribe-1.0 (file + realtime), proxied server-side so the API key
 * never reaches clients. TTS defaults to natural local neural voices (Kokoro, runs inside this process, free and
 * private); an OpenAI-compatible /audio/speech endpoint (e.g. Kokoro-FastAPI, OpenAI) or on-device speech can be
 * configured instead.
 */
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { HttpsProxyAgent } from 'https-proxy-agent';
import WebSocket from 'ws';
import { NATURAL_VOICE_LANGS, NATURAL_VOICES } from '@muse/core/voice';
import type { Deps } from '../deps.js';
import { defaultVoices, ElevenError, ElevenLabs, keyHint, looksLikeElevenKey } from '../elevenlabs.js';
import { LocalTTS } from '../tts.js';
import { appendAudit } from '@muse/db';

export function toWav24k(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-f', 'wav', 'pipe:1']);
    const out: Buffer[] = [];
    p.stdout.on('data', (b: Buffer) => out.push(b));
    p.on('error', () => reject(new Error('ffmpeg is not installed; send 16/24 kHz mono WAV instead')));
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('audio conversion failed'))));
    p.stdin.end(input);
  });
}

/** True if the buffer is a RIFF/WAVE mono 16-bit file at 16 or 24 kHz. */
export function isSupportedWav(b: Buffer): boolean {
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return false;
  const channels = b.readUInt16LE(22);
  const rate = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  return channels === 1 && bits === 16 && (rate === 16000 || rate === 24000);
}

export async function transcribeWav(baseUrl: string, apiKey: string, wav: Buffer, language?: string): Promise<string> {
  const form = new FormData();
  const request: Record<string, unknown> = { model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' };
  if (language) request.languageBias = [language];
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/asr/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, accept: 'text/plain' }, body: form });
  const text = await r.text();
  if (!r.ok) throw new Error(`Transcription failed (${r.status})`);
  // The API may answer with plain text or with JSON ({ transcript, turns, ... }).
  if (/^\s*\{/.test(text)) {
    try { return String((JSON.parse(text) as { transcript?: string }).transcript ?? '').trim(); } catch { /* plain text after all */ }
  }
  return text.trim();
}

const LANG_NAMES: Record<string, string> = { en: 'English', de: 'German', fr: 'French', it: 'Italian', es: 'Spanish' };

export function voiceRoutes(app: FastifyInstance, d: Deps) {
  const auth = { preHandler: app.auth };

  const t = d.cfg.tts;
  const local = t.provider === 'local'
    ? new LocalTTS({ modelId: t.model || 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: (t.dtype as 'q8') || 'q8', cacheDir: t.cacheDir })
    : null;
  // Warm the model in the background so the first reply in voice mode doesn't wait for the download.
  if (local && t.preload && process.env.NODE_ENV !== 'test') void local.load().catch(() => {});
  const eleven = new ElevenLabs(d.cfg.elevenlabsBaseUrl, d.vault);
  const userLang = async (userId: string): Promise<string> => {
    const u = await d.db.one('SELECT settings FROM users WHERE id=$1', [userId]);
    return String(u?.settings?.language ?? 'en');
  };
  const naturalAvailable = () => (t.provider === 'openai-compatible' ? !!t.baseUrl : !!local && local.status !== 'error');

  app.get('/v1/voice/config', auth, async (req) => ({
    stt: d.cfg.sttProvider !== 'none' && !!d.cfg.modelApiKey,
    tts: t.provider,
    natural: {
      available: naturalAvailable(),
      status: local?.status ?? (naturalAvailable() ? 'ready' : 'off'),
      languages: NATURAL_VOICE_LANGS,
      voices: NATURAL_VOICES,
    },
    elevenlabs: await eleven.status(req.user!.id).catch(() => ({ configured: false, keyHint: null })),
  }));

  // ---------- ElevenLabs (the user's own key, stored encrypted in their vault) ----------
  app.get('/v1/voice/elevenlabs', auth, async (req) => eleven.status(req.user!.id));

  app.put('/v1/voice/elevenlabs', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const apiKey = String((req.body as { apiKey?: string } | undefined)?.apiKey ?? '').trim();
    if (!looksLikeElevenKey(apiKey)) return reply.code(400).send({ code: 'invalid', message: 'That does not look like an ElevenLabs API key (it starts with sk_)' });
    try {
      const voices = await eleven.save(req.user!.id, apiKey);
      await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'setup.elevenlabs', actor: 'user', summary: `Connected ElevenLabs voices (key ${keyHint(apiKey)})` }));
      return { ok: true, keyHint: keyHint(apiKey), voices };
    } catch (e) {
      if (e instanceof ElevenError) return reply.code(e.status === 401 ? 400 : e.status).send({ code: e.code, message: e.message });
      return reply.code(502).send({ code: 'elevenlabs_unreachable', message: 'Could not reach ElevenLabs. Check the server can access api.elevenlabs.io.' });
    }
  });

  app.delete('/v1/voice/elevenlabs', auth, async (req) => {
    await eleven.remove(req.user!.id);
    await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'setup.elevenlabs', actor: 'user', summary: 'Removed the ElevenLabs key' }));
    return { ok: true };
  });

  app.get('/v1/voice/elevenlabs/voices', auth, async (req, reply) => {
    const key = await eleven.key(req.user!.id);
    if (!key) return reply.code(409).send({ code: 'elevenlabs_not_configured', message: 'Add your ElevenLabs API key first' });
    try {
      return { voices: await eleven.voices(key) };
    } catch (e) {
      if (e instanceof ElevenError && e.code === 'elevenlabs_permissions') return { voices: defaultVoices() };
      if (e instanceof ElevenError) return reply.code(e.status).send({ code: e.code, message: e.message });
      return reply.code(502).send({ code: 'elevenlabs_unreachable', message: 'Could not reach ElevenLabs' });
    }
  });

  app.post('/v1/voice/transcribe', { ...auth, bodyLimit: 15 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!d.cfg.modelApiKey || d.cfg.sttProvider === 'none') return reply.code(501).send({ code: 'stt_disabled', message: 'Speech-to-text is not configured' });
    const { audio, language } = (req.body ?? {}) as { audio?: string; mime?: string; language?: string };
    if (!audio) return reply.code(400).send({ code: 'invalid', message: 'audio (base64) required' });
    let buf: Buffer = Buffer.from(audio, 'base64');
    try {
      if (!isSupportedWav(buf)) buf = await toWav24k(buf);
    } catch (e) {
      return reply.code(415).send({ code: 'audio_unsupported', message: (e as Error).message });
    }
    const lang = language && LANG_NAMES[language] ? language : await userLang(req.user!.id);
    try {
      return { text: await transcribeWav(d.cfg.llmBaseUrl, d.cfg.modelApiKey, buf, LANG_NAMES[lang]) };
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'transcription failed');
      return reply.code(502).send({ code: 'stt_failed', message: 'Could not transcribe the recording' });
    }
  });

  /** Realtime STT: client streams 24 kHz PCM16 mono frames; we relay to Meta and stream transcripts back. */
  app.get('/v1/voice/stream', { websocket: true, preHandler: app.auth }, (socket) => {
    if (!d.cfg.modelApiKey) { socket.close(1011, 'stt not configured'); return; }
    const wsUrl = d.cfg.llmBaseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + `/asr/realtime?sessionId=muse-${Date.now()}`;
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const up = new WebSocket(wsUrl, proxy ? { agent: new HttpsProxyAgent(proxy) } : {});
    const pending: Buffer[] = [];
    let ready = false;
    up.on('open', () => {
      up.send(JSON.stringify({ authorization: { accessToken: `Bearer ${d.cfg.modelApiKey}` }, audioEncoding: 'PCM_24KHZ', model: 'muse-voice-transcribe-1.0', mode: 'PUSH_TO_TALK' }));
    });
    up.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: { sessionId?: string; type?: string; transcript?: string; message?: string; final?: boolean };
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (!ready && msg.sessionId) {
        ready = true;
        for (const b of pending.splice(0)) up.send(b);
        return;
      }
      if ((msg.type === 'transcript' || msg.type === 'error') && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: msg.type, text: msg.transcript ?? msg.message, final: !!msg.final }));
    });
    up.on('close', () => socket.close(1000));
    up.on('error', () => socket.close(1011, 'upstream error'));
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        if (String(data).includes('endStream') && up.readyState === WebSocket.OPEN) up.send(JSON.stringify({ type: 'endStream' }));
        return;
      }
      if (ready) up.send(data);
      else if (pending.length < 200) pending.push(data);
    });
    socket.on('close', () => { try { up.close(); } catch { /* not connected yet */ } });
  });

  app.post('/v1/voice/tts', { ...auth, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { text, voice, speed, engine, lang, model } = (req.body ?? {}) as { text?: string; voice?: string; speed?: number; engine?: string; lang?: string; model?: string };
    const input = String(text ?? '').slice(0, 1200);
    if (!input.trim()) return reply.code(400).send({ code: 'invalid', message: 'text required' });
    if (engine === 'elevenlabs') {
      const key = await eleven.key(req.user!.id);
      if (!key) return reply.code(409).send({ code: 'elevenlabs_not_configured', message: 'Add your ElevenLabs API key in Settings' });
      try {
        const mp3 = await eleven.synth(key, { text: input, voiceId: String(voice ?? ''), model: String(model ?? ''), lang: String(lang ?? ''), speed: Number(speed ?? 1) });
        reply.header('content-type', 'audio/mpeg').header('cache-control', 'private, max-age=3600');
        return reply.send(mp3);
      } catch (e) {
        if (e instanceof ElevenError) return reply.code(e.status === 401 ? 424 : e.status).send({ code: e.code, message: e.message });
        return reply.code(502).send({ code: 'elevenlabs_unreachable', message: 'Could not reach ElevenLabs' });
      }
    }
    if (local) {
      try {
        const wav = await local.synth(input, String(voice ?? ''), Number(speed ?? 1));
        reply.header('content-type', 'audio/wav').header('cache-control', 'private, max-age=3600');
        return reply.send(wav);
      } catch (e) {
        return reply.code(503).send({ code: 'tts_unavailable', message: `Natural voice not ready: ${(e as Error).message.slice(0, 120)}` });
      }
    }
    if (t.provider !== 'openai-compatible' || !t.baseUrl) return reply.code(501).send({ code: 'device_tts', message: 'Use on-device speech synthesis' });
    const r = await fetch(`${t.baseUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.apiKey ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: t.model, input, voice: t.voice || voice || 'af_heart', speed: Number(speed ?? 1), response_format: 'mp3' }),
    });
    if (!r.ok) return reply.code(502).send({ code: 'tts_failed', message: `TTS ${r.status}` });
    reply.header('content-type', 'audio/mpeg');
    return reply.send(Buffer.from(await r.arrayBuffer()));
  });
}
