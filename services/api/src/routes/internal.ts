/**
 * Internal endpoints for the agent runtime (authenticated with INTERNAL_TOKEN, not exposed publicly in compose).
 * The agent can only (a) ask the executor to run a Sentinel-approved action, (b) file an approval request,
 * (c) send a notification. It never receives secrets from here.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ActionRequest } from '@muse/security';
import { createApproval } from '../approvals.js';
import { ConnectorError } from '../connectors/index.js';
import type { Deps } from '../deps.js';
import { ExecutionDenied, type SentinelResponse } from '../executor.js';

export function internalRoutes(app: FastifyInstance, d: Deps) {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const got = Buffer.from(String(req.headers['x-internal-token'] ?? ''));
    const want = Buffer.from(d.cfg.internalToken);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return reply.code(401).send({ code: 'unauthorized' });
  };

  app.post('/internal/execute', { preHandler: guard }, async (req, reply) => {
    const { action, sentinelToken } = req.body as { action: ActionRequest; sentinelToken: string };
    try {
      return { ok: true, result: await d.executor.execute(action, sentinelToken) };
    } catch (e) {
      if (e instanceof ExecutionDenied) return reply.code(403).send({ ok: false, code: 'denied', message: e.message });
      if (e instanceof ConnectorError) return reply.code(400).send({ ok: false, code: e.code, message: e.message });
      throw e;
    }
  });

  app.post('/internal/approvals', { preHandler: guard }, async (req, reply) => {
    const { action, sentinel, preview } = req.body as { action: ActionRequest; sentinel: SentinelResponse; preview: Record<string, unknown> };
    // The approval must carry a genuine Sentinel "ask" for this exact action.
    const claims = d.executor.verify(action, sentinel.token);
    if (!claims || claims.d !== 'ask') return reply.code(403).send({ code: 'denied', message: 'No valid Sentinel ask decision' });
    return { approvalId: await createApproval(d, action, sentinel, preview ?? {}) };
  });

  app.post('/internal/notify', { preHandler: guard }, async (req) => {
    const { userId, title, body, url } = req.body as { userId: string; title: string; body: string; url: string };
    await d.notifier.notify(userId, { title: String(title).slice(0, 120), body: String(body).slice(0, 400), url: String(url ?? '/') });
    return { ok: true };
  });
}
