/**
 * Client for a user's sandbox browser control server. The executor uses it for the two sensitive browser actions
 * (form submit / login). Each call carries an executor grant signed with EXECUTOR_PRIVATE_KEY, which the sandbox
 * verifies; the agent cannot mint grants, so it cannot submit forms or inject credentials on its own.
 */
import type { Redis } from 'ioredis';
import { canonical, loadPrivate, signClaims } from '@muse/security';
import { createHash, type KeyObject } from 'node:crypto';

export interface SandboxInfo { url: string; token: string }

export function grantHash(userId: string, op: string, args: Record<string, unknown>): string {
  return createHash('sha256').update(canonical({ u: userId, op, args })).digest('hex');
}

export class SandboxClient {
  private key: KeyObject;
  constructor(private redis: Redis, executorPrivateKeyB64: string) {
    this.key = loadPrivate(executorPrivateKeyB64);
  }

  async info(userId: string): Promise<SandboxInfo | null> {
    const v = await this.redis.get(`sandbox:${userId}`);
    return v ? (JSON.parse(v) as SandboxInfo) : null;
  }

  async call<T = any>(userId: string, op: string, args: Record<string, unknown>, sensitive = false): Promise<T> {
    const info = await this.info(userId);
    if (!info) throw new Error('No browser session is running');
    const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${info.token}` };
    if (sensitive) headers['x-executor-grant'] = signClaims(this.key, { iss: 'executor', u: userId, h: grantHash(userId, op, args), d: 'allow', exp: Date.now() + 60_000 });
    const r = await fetch(`${info.url}/${op}`, { method: 'POST', headers, body: JSON.stringify(args) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message ?? `sandbox ${op} failed (${r.status})`);
    return j as T;
  }
}
