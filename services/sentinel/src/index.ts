import { createDb } from '@muse/db';
import { createProvider } from '@muse/llm';
import { env, log } from '@muse/runtime';
import { loadPrivate } from '@muse/security';
import { createEgressProxy } from './egress.js';
import { buildServer } from './server.js';

const db = createDb(env('SENTINEL_DATABASE_URL', process.env.DATABASE_URL), 5);
const reviewKey = process.env.SENTINEL_MODEL_API_KEY || process.env.MODEL_API_KEY;
const llm = reviewKey && process.env.LLM_PROVIDER !== 'scripted'
  ? createProvider({ ...process.env, MODEL_API_KEY: reviewKey })
  : null;
const globalBlocked = (process.env.SENTINEL_BLOCKED_DOMAINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const app = buildServer({
  db,
  llm,
  model: process.env.SENTINEL_MODEL || undefined,
  privateKey: loadPrivate(env('SENTINEL_PRIVATE_KEY')),
  publicKeyB64: env('SENTINEL_PUBLIC_KEY'),
  clientToken: env('SENTINEL_CLIENT_TOKEN'),
  spendLimitCents: Number(process.env.SPEND_LIMIT_CENTS ?? 50_000),
  globalBlocked,
});
const port = Number(process.env.SENTINEL_PORT ?? 4100);
await app.listen({ host: '0.0.0.0', port });

const blockedCache = new Map<string, { at: number; v: string[] }>();
const proxy = createEgressProxy({
  secret: env('SANDBOX_PROXY_SECRET'),
  globalBlocked,
  allowPrivateHosts: (process.env.EGRESS_ALLOW_PRIVATE_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  upstream: process.env.EGRESS_UPSTREAM_PROXY || undefined,
  async userBlocked(userId) {
    const c = blockedCache.get(userId);
    if (c && c.at > Date.now() - 30_000) return c.v;
    const r = await db.one('SELECT settings FROM users WHERE id=$1', [userId]).catch(() => null);
    const v = (r?.settings?.blockedDomains as string[]) ?? [];
    blockedCache.set(userId, { at: Date.now(), v });
    return v;
  },
  log(userId, host, allowed, reason) {
    db.q('INSERT INTO egress_log(user_id, host, allowed, reason) VALUES ($1,$2,$3,$4)', [userId, host, allowed, reason]).catch(() => {});
  },
});
const egressPort = Number(process.env.EGRESS_PORT ?? 8899);
proxy.listen(egressPort, '0.0.0.0');
log.info({ port, egressPort, review: !!llm }, 'sentinel listening');
