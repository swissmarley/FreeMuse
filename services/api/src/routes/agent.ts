import type { FastifyInstance } from 'fastify';
import { appendAudit, listApprovals, listAudit, listMemories, listTasks, mapApproval, updateTask, verifyChain } from '@muse/db';
import { ApprovalError, resolveApproval } from '../approvals.js';
import type { Deps } from '../deps.js';

const publicApproval = (a: ReturnType<typeof mapApproval>) => {
  const { sentinel: _s, payloadHash: _h, thread: _t, callId: _c, ...rest } = a;
  return rest;
};

export function agentRoutes(app: FastifyInstance, d: Deps) {
  const auth = { preHandler: app.auth };

  // ---------- approvals ----------
  app.get('/v1/approvals', auth, async (req) => {
    const { status } = req.query as { status?: string };
    const rows = await listApprovals(d.db, req.user!.id, status && status !== 'all' ? status : undefined);
    return { approvals: rows.map(publicApproval) };
  });

  app.post('/v1/approvals/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { decision, editedPayload } = (req.body ?? {}) as { decision?: string; editedPayload?: Record<string, unknown> };
    if (decision !== 'approve' && decision !== 'reject') return reply.code(400).send({ code: 'invalid', message: 'decision must be approve or reject' });
    try {
      const a = await resolveApproval(d, req.user!.id, id, decision, editedPayload && typeof editedPayload === 'object' ? editedPayload : undefined);
      return { approval: publicApproval(a as any) };
    } catch (e) {
      if (e instanceof ApprovalError) return reply.code(e.status).send({ code: e.code, message: e.message });
      throw e;
    }
  });

  // ---------- audit trail (+ planned future steps) ----------
  app.get('/v1/audit', auth, async (req) => {
    const { taskId, before } = req.query as { taskId?: string; before?: string };
    const userId = req.user!.id;
    const events = await listAudit(d.db, userId, { taskId, before: before ? Number(before) : undefined, limit: 100 });
    const tasks = await d.db.q("SELECT id, title, plan, next_run_at FROM tasks WHERE user_id=$1 AND status NOT IN ('done','failed','cancelled') AND ($2::uuid IS NULL OR id=$2)", [userId, taskId ?? null]);
    const planned = tasks.flatMap((t) => [
      ...(t.plan as { title: string; status: string }[]).filter((s) => s.status === 'pending' || s.status === 'running' || s.status === 'blocked').map((s) => ({ taskId: t.id, title: t.title, step: s.title })),
      ...(t.next_run_at ? [{ taskId: t.id, title: t.title, step: `Check back at ${new Date(t.next_run_at).toISOString()}` }] : []),
    ]);
    return { events, planned, chainValid: await verifyChain(d.db, userId) };
  });

  // ---------- tasks ----------
  app.get('/v1/tasks', auth, async (req) => ({ tasks: await listTasks(d.db, req.user!.id) }));
  app.post('/v1/tasks/:id/cancel', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await updateTask(d.db, req.user!.id, id, { status: 'cancelled', nextRunAt: null });
    if (!t) return reply.code(404).send({ code: 'not_found', message: 'Task not found' });
    await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'task.cancelled', actor: 'user', summary: `You cancelled: ${t.title}`, taskId: id }));
    await d.bus.emit(req.user!.id, { type: 'task.updated', taskId: id, status: 'cancelled', title: t.title, progress: t.progress });
    return { task: t };
  });

  // ---------- memories ----------
  app.get('/v1/memories', auth, async (req) => ({ memories: await listMemories(d.db, req.user!.id) }));
  app.delete('/v1/memories/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await d.db.one('DELETE FROM memories WHERE id=$1 AND user_id=$2 RETURNING content', [id, req.user!.id]);
    if (!r) return reply.code(404).send({ code: 'not_found', message: 'Memory not found' });
    await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'memory.forgotten', actor: 'user', summary: 'You deleted a memory' }));
    const n = await d.db.one('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [req.user!.id]);
    await d.bus.emit(req.user!.id, { type: 'memory.updated', count: n.n });
    return { ok: true };
  });
  app.post('/v1/memories', auth, async (req, reply) => {
    const { content } = (req.body ?? {}) as { content?: string };
    if (!content?.trim() || content.length > 500) return reply.code(400).send({ code: 'invalid', message: '1-500 characters' });
    const r = await d.db.one("INSERT INTO memories(user_id, content, kind, source, importance) VALUES ($1,$2,'fact','you',0.8) RETURNING *", [req.user!.id, content.trim()]);
    await d.bus.queues.memory.add('embed', { userId: req.user!.id, kind: 'embed', memoryId: r.id });
    await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'memory.added', actor: 'user', summary: 'You added a memory' }));
    return { memory: { id: r.id, content: r.content, kind: r.kind, source: r.source, importance: r.importance, createdAt: r.created_at, lastUsedAt: null } };
  });

  // ---------- notifications & push ----------
  app.get('/v1/notifications', auth, async (req) => ({
    notifications: (await d.db.q('SELECT id, title, body, url, read, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user!.id]))
      .map((n) => ({ ...n, createdAt: new Date(n.created_at).toISOString() })),
  }));
  app.post('/v1/notifications/read', auth, async (req) => {
    await d.db.q('UPDATE notifications SET read=true WHERE user_id=$1', [req.user!.id]);
    return { ok: true };
  });
  app.get('/v1/push/vapid', async () => ({ publicKey: d.cfg.vapidPublic ?? null }));
  app.post('/v1/push/register', auth, async (req, reply) => {
    const { kind, token } = (req.body ?? {}) as { kind?: string; token?: unknown };
    if ((kind !== 'webpush' && kind !== 'expo') || !token) return reply.code(400).send({ code: 'invalid', message: 'kind and token required' });
    await d.db.q('INSERT INTO push_subscriptions(user_id, kind, token) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.user!.id, kind, JSON.stringify(token)]);
    return { ok: true };
  });
}
