import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { appendAudit, insertMessage, listMessages } from '@muse/db';
import type { Deps } from '../deps.js';

const MAX_FILE = 10 * 1024 * 1024;
const ALLOWED_MIME = /^(text\/|application\/pdf$|image\/(png|jpeg|webp|gif)$|application\/json$)/;

/** One Redis subscription per process; fan out to every open SSE stream of that user. */
export class EventHub {
  private streams = new Map<string, Set<FastifyReply>>();
  constructor(private d: Deps) {
    d.sub.on('message', (channel: string, msg: string) => {
      const userId = channel.slice('events:'.length);
      for (const r of this.streams.get(userId) ?? []) r.raw.write(`data: ${msg}\n\n`);
    });
  }
  async add(userId: string, reply: FastifyReply) {
    let set = this.streams.get(userId);
    if (!set) {
      set = new Set();
      this.streams.set(userId, set);
      await this.d.sub.subscribe(this.d.bus.channel(userId));
    }
    set.add(reply);
  }
  async remove(userId: string, reply: FastifyReply) {
    const set = this.streams.get(userId);
    set?.delete(reply);
    if (set && set.size === 0) {
      this.streams.delete(userId);
      await this.d.sub.unsubscribe(this.d.bus.channel(userId));
    }
  }
}

export function chatRoutes(app: FastifyInstance, d: Deps) {
  const auth = { preHandler: app.auth };
  const hub = new EventHub(d);

  app.get('/v1/events', auth, async (req, reply) => {
    const userId = req.user!.id;
    const origin = req.headers.origin;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(origin && d.cfg.webOrigin.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {}),
    });
    reply.raw.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    await hub.add(userId, reply);
    const ping = setInterval(() => reply.raw.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      void hub.remove(userId, reply);
    });
    return reply.hijack();
  });

  app.get('/v1/conversations/:cid/messages', auth, async (req) => {
    const { cid } = req.params as { cid: string };
    const { before } = req.query as { before?: string };
    return { messages: await listMessages(d.db, req.user!.id, cid, 60, before) };
  });

  app.post('/v1/conversations/:cid/messages', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { cid } = req.params as { cid: string };
    const body = (req.body ?? {}) as { text?: string; attachments?: { fileId: string }[] };
    const text = String(body.text ?? '').trim();
    if (!text || text.length > 20_000) return reply.code(400).send({ code: 'invalid', message: 'Message must be 1-20000 characters' });
    const userId = req.user!.id;
    const attachments = (body.attachments ?? []).slice(0, 5).filter((a) => typeof a.fileId === 'string');
    const message = await insertMessage(d.db, { userId, conversationId: cid, role: 'user', text, meta: attachments.length ? { attachments } : {} });
    await d.bus.emit(userId, { type: 'message.created', message });
    const turnId = randomUUID();
    await d.db.tx((c) => appendAudit(c, { userId, kind: 'chat.user', actor: 'user', summary: text.slice(0, 140) }));
    await d.bus.queues.turns.add('chat', { userId, conversationId: cid, turnId, kind: 'chat', text, attachments }, { jobId: turnId });
    return { message, turnId };
  });

  app.post('/v1/files', { ...auth, bodyLimit: MAX_FILE * 1.4 }, async (req, reply) => {
    const { name, mime, base64 } = (req.body ?? {}) as { name?: string; mime?: string; base64?: string };
    if (!name || !mime || !base64) return reply.code(400).send({ code: 'invalid', message: 'name, mime and base64 are required' });
    if (!ALLOWED_MIME.test(mime)) return reply.code(415).send({ code: 'unsupported', message: 'Only text, JSON, PDF and images are supported' });
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > MAX_FILE) return reply.code(413).send({ code: 'too_large', message: 'Max 10 MB' });
    const f = await d.db.one('INSERT INTO files(user_id, name, mime, data) VALUES ($1,$2,$3,$4) RETURNING id', [req.user!.id, name.slice(0, 200), mime, buf]);
    return { fileId: f.id };
  });
}
