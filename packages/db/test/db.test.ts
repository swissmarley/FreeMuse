import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendItems, audit, createDb, insertMemory, listAudit, loadItems, migrate, searchMemories, verifyChain, type Db } from '../src/index.js';
import { HashEmbedding } from '../../llm/src/embeddings.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('db', () => {
  let db: Db;
  let userId: string;
  beforeAll(async () => {
    db = createDb(url!);
    await migrate(db);
    const u = await db.one("INSERT INTO users(email, password_hash, birth_year, age_verified_at) VALUES ($1,'x',1990,now()) RETURNING id", [`t${Date.now()}@x.io`]);
    userId = u.id;
  });
  afterAll(async () => {
    await db.tx(async (c) => { await c.query("SET LOCAL muse.erase = 'on'"); await c.query('DELETE FROM users WHERE id=$1', [userId]); });
    await db.close();
  });

  it('audit is hash-chained, append-only and redacts secrets', async () => {
    await audit(db, { userId, kind: 'tool.call', actor: 'agent', summary: 'a', data: { password: 'hunter2', q: 'x' } });
    await audit(db, { userId, kind: 'tool.call', actor: 'agent', summary: 'b' });
    const ev = await listAudit(db, userId);
    expect(ev).toHaveLength(2);
    expect(ev[1]!.data.password).toBe('[redacted]');
    expect(await verifyChain(db, userId)).toBe(true);
    await expect(db.q("UPDATE audit_events SET summary='x' WHERE user_id=$1", [userId])).rejects.toThrow(/append-only/);
    await expect(db.q('DELETE FROM audit_events WHERE user_id=$1', [userId])).rejects.toThrow(/append-only/);
  });

  it('keeps reasoning only for the latest turn', async () => {
    await appendItems(db, userId, 'conv:t', 't1', [{ type: 'message', role: 'user', content: 'a' }, { type: 'reasoning', encrypted_content: 'E1', summary: [] }]);
    await appendItems(db, userId, 'conv:t', 't2', [{ type: 'message', role: 'user', content: 'b' }, { type: 'reasoning', encrypted_content: 'E2', summary: [] }]);
    const items = await loadItems(db, userId, 'conv:t');
    expect(items.filter((i) => i.item.type === 'reasoning').map((i) => i.item.encrypted_content)).toEqual(['E2']);
  });

  it('hybrid memory search', async () => {
    const e = new HashEmbedding();
    for (const c of ['Anna is vegetarian', 'User prefers window seats on flights', 'Car insurance renews in March']) {
      const [v] = await e.embed([c]);
      await insertMemory(db, { userId, content: c, kind: 'fact', source: 'test', importance: 0.5, embedding: v! });
    }
    const [qv] = await e.embed(['book a flight seat']);
    const res = await searchMemories(db, userId, 'book a flight seat', qv!, 3);
    expect(res[0]!.content).toMatch(/window seats/);
  });
});
