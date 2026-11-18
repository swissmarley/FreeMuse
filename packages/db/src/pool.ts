import pg from 'pg';

export type Queryable = Pick<pg.PoolClient, 'query'>;

export interface Db {
  pool: pg.Pool;
  q<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDb(url: string, max = 10): Db {
  const pool = new pg.Pool({ connectionString: url, max });
  pool.on('error', () => { /* idle client errors are retried on next checkout */ });
  return {
    pool,
    async q(sql, params) { return (await pool.query(sql, params as any[])).rows; },
    async one(sql, params) { return (await pool.query(sql, params as any[])).rows[0] ?? null; },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
