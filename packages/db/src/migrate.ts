import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(db: Db): Promise<string[]> {
  await db.q('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.q<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(dir, f), 'utf8');
    await db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(4242)');
      const again = await c.query('SELECT 1 FROM schema_migrations WHERE name = $1', [f]);
      if (again.rowCount) return;
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      applied.push(f);
    });
  }
  return applied;
}
