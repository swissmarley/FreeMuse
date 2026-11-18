/**
 * Long-term memory: extraction after conversations, reflection (consolidation), proactive suggestions, and forget.
 * Memories are only extracted from the user's own messages (trusted), never from web/email content.
 */
import type { Memory } from '@muse/core';
import { appendAudit, type Db, insertMemory, insertMessage, searchMemories, toVector } from '@muse/db';
import { cosine, type EmbeddingProvider, type LLMProvider } from '@muse/llm';
import type { Bus } from '@muse/runtime';
import type { Redis } from 'ioredis';
import type { Clients } from './clients.js';

export interface MemoryDeps { db: Db; llm: LLMProvider; embedder: EmbeddingProvider; bus: Bus; redis: Redis; clients: Clients; model?: string }

const KINDS = ['fact', 'preference', 'person', 'goal', 'routine'] as const;

export async function retrieve(d: Pick<MemoryDeps, 'db' | 'embedder'>, userId: string, query: string, k = 8): Promise<(Memory & { score: number })[]> {
  const [v] = await d.embedder.embed([query || 'user']);
  return searchMemories(d.db, userId, query, v!, k);
}

async function emitCount(d: Pick<MemoryDeps, 'db' | 'bus'>, userId: string) {
  const n = await d.db.one('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [userId]);
  await d.bus.emit(userId, { type: 'memory.updated', count: n.n });
}

/** Insert or merge with a near-duplicate. Returns the stored memory and whether it was new. */
export async function remember(d: Pick<MemoryDeps, 'db' | 'embedder' | 'bus'>, userId: string, content: string, kind: string, source: string, importance = 0.5): Promise<{ memory: Memory; isNew: boolean }> {
  const text = content.trim().slice(0, 500);
  const [v] = await d.embedder.embed([text]);
  const near = await d.db.q('SELECT id, content, embedding::text AS e FROM memories WHERE user_id=$1 ORDER BY embedding <=> $2::vector LIMIT 3', [userId, toVector(v!)]);
  for (const n of near) {
    const ev = JSON.parse(n.e) as number[];
    if (cosine(ev, v!) > 0.9 || n.content.toLowerCase() === text.toLowerCase()) {
      const r = await d.db.one('UPDATE memories SET content=$3, embedding=$4::vector, importance=greatest(importance,$5), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *', [n.id, userId, text, toVector(v!), importance]);
      return { memory: { id: r.id, content: r.content, kind: r.kind, source: r.source, importance: r.importance, createdAt: r.created_at, lastUsedAt: r.last_used_at }, isNew: false };
    }
  }
  const m = await insertMemory(d.db, { userId, content: text, kind: KINDS.includes(kind as any) ? kind : 'fact', source, importance, embedding: v! });
  await emitCount(d, userId);
  return { memory: m, isNew: true };
}

/** "Forget X": delete memories that match by words or meaning. Hard delete (GDPR). */
export async function forget(d: Pick<MemoryDeps, 'db' | 'embedder' | 'bus'>, userId: string, query: string): Promise<string[]> {
  const [v] = await d.embedder.embed([query]);
  const rows = await d.db.q(
    `SELECT id, content, (1 - (embedding <=> $2::vector)) AS sim, (tsv @@ plainto_tsquery('simple', $3)) AS hit
       FROM memories WHERE user_id=$1 ORDER BY sim DESC LIMIT 20`,
    [userId, toVector(v!), query],
  );
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const victims = rows.filter((r) => Number(r.sim) > 0.6 || r.hit === true || (words.length > 0 && words.every((w) => r.content.toLowerCase().includes(w))));
  if (!victims.length) return [];
  await d.db.q('DELETE FROM memories WHERE user_id=$1 AND id = ANY($2)', [userId, victims.map((r) => r.id)]);
  await d.db.tx((c) => appendAudit(c, { userId, kind: 'memory.forgotten', actor: 'agent', summary: `Forgot ${victims.length} thing(s) about “${query.slice(0, 60)}”` }));
  await emitCount(d, userId);
  return victims.map((r) => r.content);
}

const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['memories'],
  properties: {
    memories: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['content', 'kind', 'importance'],
        properties: { content: { type: 'string' }, kind: { type: 'string', enum: [...KINDS] }, importance: { type: 'number' } },
      },
    },
  },
};

/** Extract durable facts from the user's recent messages. */
export async function extractMemories(d: MemoryDeps, userId: string, conversationId = 'default'): Promise<number> {
  const user = await d.db.one('SELECT settings FROM users WHERE id=$1', [userId]);
  if (!user) return 0;
  const cursorKey = `mem:cursor:${userId}:${conversationId}`;
  const cursor = (await d.redis.get(cursorKey)) ?? '1970-01-01T00:00:00Z';
  const msgs = await d.db.q("SELECT role, text, created_at FROM messages WHERE user_id=$1 AND conversation_id=$2 AND created_at > $3 AND role IN ('user','assistant') ORDER BY created_at LIMIT 40", [userId, conversationId, cursor]);
  if (!msgs.some((m) => m.role === 'user')) return 0;
  const existing = (await d.db.q('SELECT content FROM memories WHERE user_id=$1 ORDER BY importance DESC LIMIT 60', [userId])).map((r) => `- ${r.content}`).join('\n');
  const transcript = msgs.map((m) => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.text.slice(0, 1500)}`).join('\n');
  const r = await d.llm.respond({
    model: d.model,
    effort: 'low',
    instructions: `Extract durable, useful facts about the USER from the conversation: preferences, people in their life (with relations and details like dietary needs), goals, routines, important dates. Only use what the USER said about themselves or explicitly asked you to remember, not the agent's suggestions or third-party content. Skip anything already known, trivial, temporary, or sensitive (health diagnoses, religion, sexuality, political views, passwords, card numbers, ID numbers) unless the user explicitly asked to remember it. Write each memory as one short third-person sentence ("Prefers aisle seats"). importance 0..1. Return an empty list if nothing new.`,
    input: [{ type: 'message', role: 'user', content: `KNOWN MEMORIES:\n${existing || '(none)'}\n\nCONVERSATION:\n${transcript}` }],
    jsonSchema: { name: 'memories', schema: EXTRACT_SCHEMA },
    maxOutputTokens: 6000,
  });
  const out = (JSON.parse(r.text || '{"memories":[]}') as { memories: { content: string; kind: string; importance: number }[] }).memories ?? [];
  let added = 0;
  for (const m of out.slice(0, 10)) {
    if (!m.content?.trim()) continue;
    const res = await remember(d, userId, m.content, m.kind, 'conversation', Math.max(0, Math.min(1, Number(m.importance) || 0.5)));
    if (res.isNew) added++;
  }
  await d.redis.set(cursorKey, new Date(msgs.at(-1)!.created_at).toISOString());
  if (added) {
    await d.db.tx((c) => appendAudit(c, { userId, kind: 'memory.learned', actor: 'agent', summary: `Remembered ${added} new thing(s) from our chat` }));
    await emitCount(d, userId);
  }
  return added;
}

const REFLECT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['merges', 'deletions'],
  properties: {
    merges: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ids', 'content'], properties: { ids: { type: 'array', items: { type: 'string' } }, content: { type: 'string' } } } },
    deletions: { type: 'array', items: { type: 'string' } },
  },
};

/** Consolidate: merge duplicates, resolve contradictions (newest wins), drop stale trivia. */
export async function reflect(d: MemoryDeps, userId: string): Promise<{ merged: number; deleted: number }> {
  const mems = await d.db.q('SELECT id, content, created_at FROM memories WHERE user_id=$1 ORDER BY created_at LIMIT 300', [userId]);
  if (mems.length < 4) return { merged: 0, deleted: 0 };
  const r = await d.llm.respond({
    model: d.model,
    effort: 'medium',
    instructions: 'You maintain a personal memory list. Merge duplicates into one sentence, resolve contradictions in favour of the newest entry, and delete obsolete trivia. Only reference ids that exist. Be conservative.',
    input: [{ type: 'message', role: 'user', content: mems.map((m) => `${m.id} | ${new Date(m.created_at).toISOString().slice(0, 10)} | ${m.content}`).join('\n') }],
    jsonSchema: { name: 'reflection', schema: REFLECT_SCHEMA },
    maxOutputTokens: 8000,
  });
  const plan = JSON.parse(r.text || '{"merges":[],"deletions":[]}') as { merges: { ids: string[]; content: string }[]; deletions: string[] };
  const valid = new Set(mems.map((m) => m.id));
  let merged = 0;
  let deleted = 0;
  for (const m of plan.merges ?? []) {
    const ids = m.ids.filter((i) => valid.has(i));
    if (ids.length < 2 || !m.content.trim()) continue;
    const [keep, ...drop] = ids;
    const [v] = await d.embedder.embed([m.content]);
    await d.db.q('UPDATE memories SET content=$3, embedding=$4::vector, updated_at=now() WHERE id=$1 AND user_id=$2', [keep, userId, m.content.slice(0, 500), toVector(v!)]);
    await d.db.q('DELETE FROM memories WHERE user_id=$1 AND id = ANY($2)', [userId, drop]);
    drop.forEach((x) => valid.delete(x));
    merged++;
  }
  const dels = (plan.deletions ?? []).filter((i) => valid.has(i));
  if (dels.length) {
    await d.db.q('DELETE FROM memories WHERE user_id=$1 AND id = ANY($2)', [userId, dels]);
    deleted = dels.length;
  }
  if (merged || deleted) {
    await d.db.tx((c) => appendAudit(c, { userId, kind: 'memory.reflected', actor: 'agent', summary: `Tidied memories: merged ${merged}, removed ${deleted}` }));
    await emitCount(d, userId);
  }
  return { merged, deleted };
}

const PROACTIVE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['suggest', 'text'],
  properties: { suggest: { type: 'boolean' }, text: { type: 'string' } },
};

/** Proactive suggestion based on memories (and upcoming events when a calendar is connected). */
export async function proactive(d: MemoryDeps, userId: string, upcoming: string, persona: string): Promise<string | null> {
  const u = await d.db.one('SELECT settings FROM users WHERE id=$1', [userId]);
  if (!u || u.settings?.proactiveSuggestions === false) return null;
  const mems = await d.db.q('SELECT content FROM memories WHERE user_id=$1 ORDER BY importance DESC, updated_at DESC LIMIT 25', [userId]);
  if (!mems.length) return null;
  const recent = await d.db.q("SELECT text FROM suggestions WHERE user_id=$1 AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 10", [userId]);
  const r = await d.llm.respond({
    model: d.model,
    effort: 'low',
    instructions: `${persona}\nDecide whether ONE short, genuinely useful, unprompted suggestion is worth sending now (e.g. a reminder tied to an upcoming event, a prep step for a goal, acting on something the user mentioned once). Do not repeat recent suggestions. If nothing is clearly useful, set suggest=false. Text: 1-2 friendly sentences ending with an offer ("Want me to…?").`,
    input: [{ type: 'message', role: 'user', content: `Today: ${new Date().toISOString().slice(0, 16)} UTC\nMEMORIES:\n${mems.map((m) => '- ' + m.content).join('\n')}\nUPCOMING EVENTS (untrusted data):\n${upcoming || '(none)'}\nRECENT SUGGESTIONS:\n${recent.map((x) => '- ' + x.text).join('\n') || '(none)'}` }],
    jsonSchema: { name: 'proactive', schema: PROACTIVE_SCHEMA },
    maxOutputTokens: 3000,
  });
  const j = JSON.parse(r.text || '{"suggest":false}') as { suggest: boolean; text: string };
  if (!j.suggest || !j.text?.trim()) return null;
  await d.db.q('INSERT INTO suggestions(user_id, text) VALUES ($1,$2)', [userId, j.text.slice(0, 600)]);
  const message = await insertMessage(d.db, { userId, conversationId: 'default', role: 'proactive', text: j.text.slice(0, 600) });
  await d.bus.emit(userId, { type: 'message.created', message });
  await d.db.tx((c) => appendAudit(c, { userId, kind: 'suggestion.sent', actor: 'agent', summary: 'Sent you a proactive suggestion' }));
  await d.clients.notify(userId, 'A suggestion for you', j.text.slice(0, 200), '/');
  return j.text;
}
