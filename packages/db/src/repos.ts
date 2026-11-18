import type { Approval, ChatMessage, Connection, Memory, PlanStep, Task } from '@muse/core';
import type { Db, Queryable } from './pool.js';

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

// ---------- messages / turn items ----------
export function mapMessage(r: any): ChatMessage {
  return { id: r.id, conversationId: r.conversation_id, role: r.role, text: r.text, citations: r.citations ?? [], meta: r.meta ?? {}, createdAt: iso(r.created_at)! };
}

export async function insertMessage(db: Db | Queryable, m: { userId: string; conversationId: string; role: string; text: string; citations?: unknown[]; meta?: Record<string, unknown> }): Promise<ChatMessage> {
  const q = 'pool' in db ? db.pool : db;
  const r = await q.query(
    'INSERT INTO messages(user_id, conversation_id, role, text, citations, meta) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [m.userId, m.conversationId, m.role, m.text, JSON.stringify(m.citations ?? []), m.meta ?? {}],
  );
  return mapMessage(r.rows[0]);
}

export async function listMessages(db: Db, userId: string, conversationId: string, limit = 50, before?: string): Promise<ChatMessage[]> {
  const rows = await db.q(
    `SELECT * FROM (SELECT * FROM messages WHERE user_id=$1 AND conversation_id=$2 AND ($3::timestamptz IS NULL OR created_at < $3)
     ORDER BY created_at DESC LIMIT $4) t ORDER BY created_at ASC`,
    [userId, conversationId, before ?? null, limit],
  );
  return rows.map(mapMessage);
}

export async function appendItems(db: Db, userId: string, thread: string, turnId: string, items: unknown[]): Promise<void> {
  if (!items.length) return;
  const vals: unknown[] = [];
  const ph = items.map((it, i) => {
    vals.push(userId, thread, turnId, JSON.stringify(it));
    return `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`;
  });
  await db.q(`INSERT INTO turn_items(user_id, thread, turn_id, item) VALUES ${ph.join(',')}`, vals);
}

/** Load replayable history: last N turns; reasoning kept only for the most recent turn (compaction). */
export async function loadItems(db: Db, userId: string, thread: string, maxTurns = 30): Promise<{ turnId: string; item: any }[]> {
  const rows = await db.q(
    `WITH recent AS (SELECT turn_id, max(id) m FROM turn_items WHERE user_id=$1 AND thread=$2 GROUP BY turn_id ORDER BY m DESC LIMIT $3)
     SELECT t.turn_id, t.item FROM turn_items t JOIN recent r USING (turn_id) WHERE t.user_id=$1 AND t.thread=$2 ORDER BY t.id`,
    [userId, thread, maxTurns],
  );
  const lastTurn = rows.at(-1)?.turn_id;
  return rows.filter((r) => r.item.type !== 'reasoning' || r.turn_id === lastTurn).map((r) => ({ turnId: r.turn_id, item: r.item }));
}

// ---------- tasks ----------
export function mapTask(r: any): Task {
  return { id: r.id, title: r.title, goal: r.goal, status: r.status, plan: r.plan ?? [], progress: Number(r.progress), nextRunAt: iso(r.next_run_at), result: r.result, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! };
}

export async function createTask(db: Db, t: { userId: string; title: string; goal: string; plan: PlanStep[]; conversationId?: string; nextRunAt?: Date | null; state?: Record<string, unknown> }): Promise<Task> {
  const r = await db.one(
    `INSERT INTO tasks(user_id, title, goal, plan, conversation_id, next_run_at, status, state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [t.userId, t.title, t.goal, JSON.stringify(t.plan), t.conversationId ?? 'default', t.nextRunAt ?? null, t.nextRunAt ? 'scheduled' : 'queued', t.state ?? {}],
  );
  return mapTask(r);
}

export async function getTask(db: Db, userId: string, id: string): Promise<(Task & { state: any; conversationId: string }) | null> {
  const r = await db.one('SELECT * FROM tasks WHERE id=$1 AND user_id=$2', [id, userId]);
  return r ? { ...mapTask(r), state: r.state, conversationId: r.conversation_id } : null;
}

export async function updateTask(db: Db, userId: string, id: string, patch: Partial<{ status: string; plan: PlanStep[]; progress: number; nextRunAt: Date | null; result: string | null; state: Record<string, unknown>; title: string }>): Promise<Task | null> {
  const sets: string[] = [];
  const vals: unknown[] = [id, userId];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.status !== undefined) add('status', patch.status);
  if (patch.plan !== undefined) add('plan', JSON.stringify(patch.plan));
  if (patch.progress !== undefined) add('progress', patch.progress);
  if (patch.nextRunAt !== undefined) add('next_run_at', patch.nextRunAt);
  if (patch.result !== undefined) add('result', patch.result);
  if (patch.state !== undefined) add('state', patch.state);
  if (patch.title !== undefined) add('title', patch.title);
  sets.push('updated_at=now()');
  const r = await db.one(`UPDATE tasks SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, vals);
  return r ? mapTask(r) : null;
}

export async function listTasks(db: Db, userId: string): Promise<Task[]> {
  return (await db.q('SELECT * FROM tasks WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100', [userId])).map(mapTask);
}

// ---------- approvals ----------
export function mapApproval(r: any): Approval & { sentinel: any; payloadHash: string; thread: string | null; callId: string | null; result: any } {
  return {
    id: r.id, taskId: r.task_id, actionClass: r.action_class, connector: r.connector, operation: r.operation, title: r.title,
    preview: r.preview, payload: r.payload, risk: r.risk, status: r.status, createdAt: iso(r.created_at)!, resolvedAt: iso(r.resolved_at),
    sentinel: r.sentinel, payloadHash: r.payload_hash, thread: r.thread, callId: r.call_id, result: r.result,
  };
}

export async function getApproval(db: Db | Queryable, userId: string, id: string) {
  const q = 'pool' in db ? db.pool : db;
  const r = (await q.query('SELECT * FROM approvals WHERE id=$1 AND user_id=$2', [id, userId])).rows[0];
  return r ? mapApproval(r) : null;
}

export async function listApprovals(db: Db, userId: string, status?: string) {
  const rows = await db.q('SELECT * FROM approvals WHERE user_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT 100', [userId, status ?? null]);
  return rows.map(mapApproval);
}

// ---------- memories ----------
export function mapMemory(r: any): Memory {
  return { id: r.id, content: r.content, kind: r.kind, source: r.source, importance: Number(r.importance), createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at) };
}
export const toVector = (v: number[]) => '[' + v.map((x) => x.toFixed(6)).join(',') + ']';

export async function insertMemory(db: Db, m: { userId: string; content: string; kind: string; source: string; importance: number; embedding: number[] }): Promise<Memory> {
  const r = await db.one(
    'INSERT INTO memories(user_id, content, kind, source, importance, embedding) VALUES ($1,$2,$3,$4,$5,$6::vector) RETURNING *',
    [m.userId, m.content, m.kind, m.source, m.importance, toVector(m.embedding)],
  );
  return mapMemory(r);
}

/** Hybrid retrieval: vector cosine + full-text rank + importance. */
export async function searchMemories(db: Db, userId: string, query: string, embedding: number[], k = 8): Promise<(Memory & { score: number })[]> {
  const rows = await db.q(
    `SELECT *, (1 - (embedding <=> $2::vector)) * 0.6
              + coalesce(ts_rank(tsv, plainto_tsquery('simple', $3)), 0) * 2
              + importance * 0.2 AS score
       FROM memories WHERE user_id=$1 ORDER BY score DESC LIMIT $4`,
    [userId, toVector(embedding), query, k],
  );
  if (rows.length) await db.q('UPDATE memories SET last_used_at=now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
  return rows.map((r) => ({ ...mapMemory(r), score: Number(r.score) }));
}

export async function listMemories(db: Db, userId: string): Promise<Memory[]> {
  return (await db.q('SELECT * FROM memories WHERE user_id=$1 ORDER BY importance DESC, created_at DESC LIMIT 500', [userId])).map(mapMemory);
}

// ---------- connections ----------
export function mapConnection(r: any): Connection {
  return { id: r.id, connector: r.connector, scopes: r.scopes, account: r.account, status: r.status, createdAt: iso(r.created_at)! };
}
export async function listConnections(db: Db, userId: string): Promise<Connection[]> {
  return (await db.q("SELECT * FROM connections WHERE user_id=$1 AND status <> 'revoked' ORDER BY created_at", [userId])).map(mapConnection);
}
export async function getConnection(db: Db, userId: string, connector: string) {
  const r = await db.one("SELECT * FROM connections WHERE user_id=$1 AND connector=$2 AND status='active'", [userId, connector]);
  return r ? { ...mapConnection(r), vaultId: r.vault_id as string | null } : null;
}

// ---------- notifications ----------
export async function addNotification(db: Db, userId: string, n: { title: string; body: string; url: string }) {
  return db.one('INSERT INTO notifications(user_id, title, body, url) VALUES ($1,$2,$3,$4) RETURNING *', [userId, n.title, n.body, n.url]);
}
