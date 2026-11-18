import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { DEFAULT_SETTINGS, type UserSettings } from '@muse/core';
import type { Db } from '@muse/db';
import type { LLMProvider } from '@muse/llm';
import { type ActionRequest, actionHash, signClaims } from '@muse/security';
import type { KeyObject } from 'node:crypto';
import { evaluatePolicy } from './policy.js';
import { reviewAction } from './review.js';

export interface SentinelDeps {
  db: Db;
  llm: LLMProvider | null;
  model?: string;
  privateKey: KeyObject;
  publicKeyB64: string;
  clientToken: string;
  spendLimitCents: number;
  globalBlocked: string[];
}

export interface AuthorizeResponse {
  decision: 'allow' | 'deny' | 'ask';
  reasons: string[];
  risk: 'low' | 'medium' | 'high';
  exfiltration: boolean;
  actionHash: string;
  token: string;
  reviewed: boolean;
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function authorize(d: SentinelDeps, a: ActionRequest): Promise<AuthorizeResponse> {
  const user = await d.db.one('SELECT settings FROM users WHERE id=$1', [a.userId]);
  if (!user) throw Object.assign(new Error('unknown user'), { statusCode: 404 });
  const settings: UserSettings = { ...DEFAULT_SETTINGS, ...(user.settings ?? {}) };
  const conn = await d.db.one("SELECT scopes FROM connections WHERE user_id=$1 AND connector=$2 AND status='active'", [a.userId, a.connector]);
  const policy = evaluatePolicy(a, { settings, grantedScopes: conn?.scopes ?? null, spendLimitCents: d.spendLimitCents, globalBlockedDomains: d.globalBlocked });
  let { decision } = policy;
  const reasons = [...policy.reasons];
  let risk = policy.risk;
  let reviewed = false;
  if (decision !== 'deny' && policy.needsReview) {
    if (d.llm) {
      try {
        const r = await reviewAction(d.llm, a, d.model);
        reviewed = true;
        if (!r.aligned) {
          reasons.push(`Sentinel review: ${r.reason}`);
          if (r.risk === 'high') { decision = 'deny'; risk = 'high'; }
          else if (decision === 'allow') decision = 'ask';
        }
      } catch {
        reasons.push('Sentinel review unavailable, so this needs your approval');
        if (decision === 'allow') decision = 'ask';
      }
    } else if (decision === 'allow') {
      decision = 'ask';
      reasons.push('Sentinel review not configured, so this needs your approval');
    }
  }
  const h = actionHash(a);
  const ttl = decision === 'ask' ? 7 * 24 * 3600_000 : 15 * 60_000;
  const token = signClaims(d.privateKey, { iss: 'sentinel', u: a.userId, h, d: decision, exp: Date.now() + ttl, r: reasons.slice(0, 5) });
  await d.db.q('INSERT INTO sentinel_decisions(user_id, action_hash, action_class, decision, reasons) VALUES ($1,$2,$3,$4,$5)', [a.userId, h, a.actionClass, decision, JSON.stringify(reasons)]);
  return { decision, reasons, risk, exfiltration: policy.exfiltration, actionHash: h, token, reviewed };
}

export function buildServer(d: SentinelDeps) {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  app.get('/health', async () => ({ ok: true }));
  app.get('/public-key', async () => ({ publicKey: d.publicKeyB64 }));
  app.post('/authorize', async (req, reply) => {
    const tok = String(req.headers['x-sentinel-client'] ?? '');
    if (!safeEq(tok, d.clientToken)) return reply.code(401).send({ code: 'unauthorized' });
    const a = req.body as ActionRequest;
    if (!a?.userId || !a.actionClass || !a.connector || !a.operation || typeof a.payload !== 'object' || !a.provenance) {
      return reply.code(400).send({ code: 'bad_request' });
    }
    return authorize(d, a);
  });
  return app;
}
