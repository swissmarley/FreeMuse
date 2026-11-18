/**
 * Voice: speech-to-text via Meta's muse-voice-transcribe-1.0 (file + realtime), proxied server-side so the API key
 * never reaches clients. TTS defaults to on-device synthesis (the Model API has no TTS); an OpenAI-compatible
 * /audio/speech endpoint can be configured instead.
 */
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { HttpsProxyAgent } from 'https-proxy-agent';
import WebSocket from 'ws';
import type { Deps } from '../deps.js';

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
  return text.trim();
}

const LANG_NAMES: Record<string, string> = { en: 'English', de: 'German', fr: 'French', it: 'Italian', es: 'Spanish' };

export function voiceRoutes(app: FastifyInstance, d: Deps) {
  const auth = { preHandler: app.auth };

  app.get('/v1/voice/config', auth, async () => ({ stt: d.cfg.sttProvider !== 'none' && !!d.cfg.modelApiKey, tts: d.cfg.tts.provider }));

  app.post('/v1/voice/transcribe', { ...auth, bodyLimit: 15 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!d.cfg.modelApiKey || d.cfg.sttProvider === 'none') return reply.code(501).send({ code: 'stt_disabled', message: 'Speech-to-text is not configured' });
    const { audio, language } = (req.body ?? {}) as { audio?: string; mime?: string; language?: string };
    if (!audio) return reply.code(400).send({ code: 'invalid', message: 'audio (base64) required' });
    let buf: Buffer = Buffer.from(audio, "base64");
    if (!isSupportedWav(buf)) buf = await toWav24k(buf);
    const text = await transcribeWav(d.cfg.llmBaseUrl, d.cfg.modelApiKey, buf, language ? LANG_NAMES[language] : undefined);
    return { text };
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
      const msg = JSON.parse(String(data));
      if (!ready && msg.sessionId) {
        ready = true;
        for (const b of pending.splice(0)) up.send(b);
        return;
      }
      if (msg.type === 'transcript' || msg.type === 'error') socket.send(JSON.stringify({ type: msg.type, text: msg.transcript ?? msg.message, final: !!msg.final }));
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
    socket.on('close', () => up.close());
  });

  app.post('/v1/voice/tts', { ...auth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const t = d.cfg.tts;
    if (t.provider !== 'openai-compatible' || !t.baseUrl) return reply.code(501).send({ code: 'device_tts', message: 'Use on-device speech synthesis' });
    const { text, voice } = (req.body ?? {}) as { text?: string; voice?: string };
    const r = await fetch(`${t.baseUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.apiKey ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: t.model, input: String(text ?? '').slice(0, 4000), voice: voice || 'alloy', response_format: 'mp3' }),
    });
    if (!r.ok) return reply.code(502).send({ code: 'tts_failed', message: `TTS ${r.status}` });
    reply.header('content-type', 'audio/mpeg');
    return reply.send(Buffer.from(await r.arrayBuffer()));
  });
}
