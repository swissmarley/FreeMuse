import { createHash } from 'node:crypto';
import type { AuditEvent } from '@muse/core';
import type { Db, Queryable } from './pool.js';

export interface AuditInput {
  userId: string;
  kind: string;
  actor: AuditEvent['actor'];
  summary: string;
  data?: Record<string, unknown>;
  taskId?: string | null;
}

const SECRET_KEYS = /pass(word)?|secret|token|card|cvc|cvv|otp|authorization|cookie/i;

/** Remove anything that looks like a secret before it reaches the audit log. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(x, depth + 1);
    return o;
  }
  if (typeof v === 'string' && v.length > 4000) return v.slice(0, 4000) + '…';
  return v;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical((v as any)[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

export function eventHash(prev: string, e: { kind: string; actor: string; summary: string; data: unknown; taskId: string | null; createdAt: string }): string {
  return createHash('sha256').update(prev + canonical(e)).digest('hex');
}

/** Append an event to the per-user hash chain (serialised per user with an advisory lock). */
export async function appendAudit(c: Queryable, input: AuditInput): Promise<AuditEvent> {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.userId]);
  const prev = (await c.query('SELECT hash FROM audit_events WHERE user_id = $1 ORDER BY seq DESC LIMIT 1', [input.userId])).rows[0]?.hash ?? 'genesis';
  const createdAt = new Date().toISOString();
  const data = redact(input.data ?? {}) as Record<string, unknown>;
  const taskId = input.taskId ?? null;
  const hash = eventHash(prev, { kind: input.kind, actor: input.actor, summary: input.summary, data, taskId, createdAt });
  const r = await c.query(
    `INSERT INTO audit_events(user_id, kind, actor, summary, data, task_id, created_at, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, seq`,
    [input.userId, input.kind, input.actor, input.summary.slice(0, 500), data, taskId, createdAt, prev, hash],
  );
  return { id: r.rows[0].id, seq: Number(r.rows[0].seq), kind: input.kind, actor: input.actor, summary: input.summary, data, taskId, createdAt, hash };
}

export async function audit(db: Db, input: AuditInput): Promise<AuditEvent> {
  return db.tx((c) => appendAudit(c, input));
}

export async function listAudit(db: Db, userId: string, opts: { taskId?: string; before?: number; limit?: number } = {}): Promise<AuditEvent[]> {
  const rows = await db.q(
    `SELECT id, seq, kind, actor, summary, data, task_id, created_at, hash FROM audit_events
     WHERE user_id = $1 AND ($2::uuid IS NULL OR task_id = $2) AND ($3::bigint IS NULL OR seq < $3)
     ORDER BY seq DESC LIMIT $4`,
    [userId, opts.taskId ?? null, opts.before ?? null, opts.limit ?? 100],
  );
  return rows.map((r) => ({ id: r.id, seq: Number(r.seq), kind: r.kind, actor: r.actor, summary: r.summary, data: r.data, taskId: r.task_id, createdAt: new Date(r.created_at).toISOString(), hash: r.hash }));
}

/** Recompute the chain; returns false if any row was tampered with. */
export async function verifyChain(db: Db, userId: string): Promise<boolean> {
  const rows = await db.q('SELECT kind, actor, summary, data, task_id, created_at, prev_hash, hash FROM audit_events WHERE user_id = $1 ORDER BY seq', [userId]);
  let prev = 'genesis';
  for (const r of rows) {
    if (r.prev_hash !== prev) return false;
    const h = eventHash(prev, { kind: r.kind, actor: r.actor, summary: r.summary, data: r.data, taskId: r.task_id, createdAt: new Date(r.created_at).toISOString() });
    if (h !== r.hash) return false;
    prev = r.hash;
  }
  return true;
}
