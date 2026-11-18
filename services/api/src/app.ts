import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { authGuard } from './auth.js';
import type { Deps } from './deps.js';
import { agentRoutes } from './routes/agent.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { connectionRoutes } from './routes/connections.js';
import { internalRoutes } from './routes/internal.js';
import { meRoutes } from './routes/me.js';
import { voiceRoutes } from './routes/voice.js';

declare module 'fastify' {
  interface FastifyInstance { auth: ReturnType<typeof authGuard> }
}

export async function buildApp(d: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-internal-token"]'] },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  await app.register(cors, { origin: d.cfg.webOrigin, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(cookie);
  await app.register(rateLimit, { global: false, redis: d.redis });
  await app.register(websocket);
  app.decorate('auth', authGuard(d.db, d.cfg.jwtSecret));
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-ai-disclosure', 'This service is operated by an AI agent');
  });
  app.get('/health', async () => ({ ok: true, region: process.env.DATA_REGION ?? 'eu' }));
  authRoutes(app, d);
  meRoutes(app, d);
  chatRoutes(app, d);
  agentRoutes(app, d);
  connectionRoutes(app, d);
  voiceRoutes(app, d);
  internalRoutes(app, d);
  return app;
}
