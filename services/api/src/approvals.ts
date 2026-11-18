/**
 * Approval lifecycle. Approving executes the exact (optionally user-edited) action through the executor and then
 * hands the outcome back to the agent so it can report or continue its task.
 */
import { randomUUID } from 'node:crypto';
import { appendAudit, getApproval, insertMessage } from '@muse/db';
import { type ActionRequest, actionHash } from '@muse/security';
import type { Deps } from './deps.js';
import type { SentinelResponse } from './executor.js';

export async function createApproval(d: Deps, action: ActionRequest, s: SentinelResponse, preview: Record<string, unknown>) {
  const row = await d.db.tx(async (c) => {
    const r = await c.query(
      `INSERT INTO approvals(user_id, task_id, thread, call_id, action_class, connector, operation, title, preview, payload, payload_hash, risk, sentinel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [action.userId, action.taskId ?? null, action.thread ?? null, action.callId ?? null, action.actionClass, action.connector, action.operation, action.title.slice(0, 200),
        preview, action.payload, actionHash(action), { level: s.risk, reasons: s.reasons }, { token: s.token, decision: s.decision, provenance: action.provenance }],
    );
    await appendAudit(c, { userId: action.userId, kind: 'approval.requested', actor: 'sentinel', summary: `Needs your OK: ${action.title}`, taskId: action.taskId ?? null, data: { approvalId: r.rows[0].id, reasons: s.reasons, risk: s.risk } });
    return r.rows[0];
  });
  if (action.taskId) await d.db.q("UPDATE tasks SET status='waiting_approval', updated_at=now() WHERE id=$1 AND user_id=$2", [action.taskId, action.userId]);
  await d.bus.emit(action.userId, { type: 'approval.created', approvalId: row.id, title: action.title });
  await d.notifier.notify(action.userId, { title: 'Approval needed', body: action.title, url: `/approvals?id=${row.id}` });
  return row.id as string;
}

export class ApprovalError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function resolveApproval(d: Deps, userId: string, id: string, decision: 'approve' | 'reject', edited?: Record<string, unknown>) {
  const a = await getApproval(d.db, userId, id);
  if (!a) throw new ApprovalError(404, 'not_found', 'Approval not found');
  if (a.status !== 'pending') throw new ApprovalError(409, 'already_resolved', `Already ${a.status}`);
  const provenance = a.sentinel.provenance;
  let action: ActionRequest = { userId, actionClass: a.actionClass, connector: a.connector, operation: a.operation, payload: a.payload, provenance, taskId: a.taskId, thread: a.thread ?? undefined, callId: a.callId ?? undefined, title: a.title };
  let token: string = a.sentinel.token;

  if (decision === 'reject') {
    await d.db.tx(async (c) => {
      await c.query("UPDATE approvals SET status='rejected', resolved_at=now() WHERE id=$1", [id]);
      await appendAudit(c, { userId, kind: 'approval.rejected', actor: 'user', summary: `You declined: ${a.title}`, taskId: a.taskId, data: { approvalId: id } });
    });
    await d.bus.emit(userId, { type: 'approval.resolved', approvalId: id, status: 'rejected' });
    await handBack(d, userId, a, `The user DECLINED the action "${a.title}". Do not retry it; acknowledge briefly and ask if they want something different.`);
    return { ...a, status: 'rejected' as const };
  }

  if (edited) {
    // Edited payloads are re-checked by the Sentinel; the approval then binds to the edited version.
    action = { ...action, payload: { ...a.payload, ...edited } };
    const s = await d.executor.authorize(action);
    if (s.decision === 'deny') throw new ApprovalError(422, 'denied', `Sentinel blocked the edited action: ${s.reasons.join('; ')}`);
    token = s.token;
    await d.db.q('UPDATE approvals SET payload=$2, payload_hash=$3, sentinel=$4 WHERE id=$1', [id, action.payload, actionHash(action), { ...a.sentinel, token, decision: s.decision }]);
  }

  await d.db.tx(async (c) => {
    await c.query("UPDATE approvals SET status='approved', resolved_at=now() WHERE id=$1", [id]);
    await appendAudit(c, { userId, kind: 'approval.approved', actor: 'user', summary: `You approved: ${a.title}${edited ? ' (edited)' : ''}`, taskId: a.taskId, data: { approvalId: id, edited: !!edited } });
  });

  let status: 'executed' | 'failed' = 'executed';
  let result: unknown;
  try {
    result = await d.executor.execute(action, token, id);
  } catch (e) {
    status = 'failed';
    result = { error: (e as Error).message };
  }
  await d.db.q('UPDATE approvals SET status=$2, result=$3 WHERE id=$1', [id, status, JSON.stringify(result)]);
  await d.bus.emit(userId, { type: 'approval.resolved', approvalId: id, status });
  await handBack(d, userId, a, status === 'executed'
    ? `The user APPROVED "${a.title}" and it was executed successfully. Result: ${JSON.stringify(result).slice(0, 2000)}. Tell the user briefly what was done, then continue any remaining steps.`
    : `The user approved "${a.title}" but execution FAILED: ${JSON.stringify(result).slice(0, 500)}. Explain plainly and suggest a fix.`);
  return { ...(await getApproval(d.db, userId, id))! };
}

/** Resume the agent: tasks continue in their own thread; chat actions get a short follow-up turn. */
async function handBack(d: Deps, userId: string, a: { taskId: string | null; thread: string | null }, note: string) {
  if (a.taskId) {
    await d.db.q("UPDATE tasks SET status='queued', updated_at=now() WHERE id=$1 AND user_id=$2 AND status='waiting_approval'", [a.taskId, userId]);
    await d.bus.queues.tasks.add('resume', { userId, taskId: a.taskId, reason: 'resume', note });
    return;
  }
  const conversationId = a.thread?.startsWith('conv:') ? a.thread.slice(5) : 'default';
  const turnId = randomUUID();
  await d.bus.queues.turns.add('resume', { userId, conversationId, turnId, kind: 'resume', note }, { jobId: turnId });
}

export { insertMessage };
