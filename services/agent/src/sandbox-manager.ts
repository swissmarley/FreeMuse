/**
 * Per-user sandbox browsers.
 *  - docker: one container per user (cap-drop ALL, no-new-privileges, read-only rootfs, tmpfs, mem/cpu/pids limits,
 *    internal network whose only exit is the Sentinel egress proxy; optional gVisor runtime).
 *  - local: in-process Chromium for development/tests (still routed through the egress proxy when configured).
 * The sandbox URL + control token are registered in Redis so the API executor can reach it for approved actions.
 */
import { randomBytes } from 'node:crypto';
import Docker from 'dockerode';
import type { Redis } from 'ioredis';
import { log } from '@muse/runtime';
import { startSandbox, type RunningSandbox } from '@muse/sandbox';
import { proxyToken } from '@muse/security';

export interface SandboxConfig {
  driver: 'docker' | 'local';
  image: string;
  network: string;
  runtime?: string;
  egressProxyUrl?: string;
  proxySecret: string;
  executorPublicKey: string;
  idleMs: number;
}

export class SandboxError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

interface Entry { url: string; token: string; lastUsed: number; local?: RunningSandbox; containerId?: string }

export class SandboxManager {
  private entries = new Map<string, Entry>();
  private starting = new Map<string, Promise<Entry>>();
  private docker?: Docker;
  constructor(private cfg: SandboxConfig, private redis: Redis) {
    if (cfg.driver === 'docker') this.docker = new Docker();
  }

  private async start(userId: string): Promise<Entry> {
    const token = randomBytes(24).toString('base64url');
    const proxy = this.cfg.egressProxyUrl ? { server: this.cfg.egressProxyUrl, username: userId, password: proxyToken(this.cfg.proxySecret, userId) } : undefined;
    let e: Entry;
    if (this.cfg.driver === 'local') {
      const sb = await startSandbox({ userId, controlToken: token, executorPublicKey: this.cfg.executorPublicKey, proxy, executablePath: process.env.SANDBOX_CHROMIUM_PATH || undefined });
      e = { url: sb.url, token, lastUsed: Date.now(), local: sb };
    } else {
      const name = `muse-sandbox-${userId.slice(0, 8)}-${randomBytes(3).toString('hex')}`;
      const c = await this.docker!.createContainer({
        Image: this.cfg.image,
        name,
        Env: [
          `SANDBOX_USER_ID=${userId}`, `CONTROL_TOKEN=${token}`, `EXECUTOR_PUBLIC_KEY=${this.cfg.executorPublicKey}`,
          ...(proxy ? [`PROXY_SERVER=${proxy.server}`, `PROXY_USERNAME=${proxy.username}`, `PROXY_PASSWORD=${proxy.password}`] : []),
        ],
        Labels: { 'muse.sandbox': 'true', 'muse.user': userId },
        HostConfig: {
          NetworkMode: this.cfg.network,
          Memory: 1024 * 1024 * 1024,
          NanoCpus: 1_000_000_000,
          PidsLimit: 512,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          ReadonlyRootfs: true,
          Tmpfs: { '/tmp': 'rw,size=256m', '/home/pwuser': 'rw,size=256m' },
          ShmSize: 256 * 1024 * 1024,
          AutoRemove: true,
          ...(this.cfg.runtime ? { Runtime: this.cfg.runtime } : {}),
        },
      });
      await c.start();
      e = { url: `http://${name}:7000`, token, lastUsed: Date.now(), containerId: c.id };
      await this.waitReady(e);
    }
    await this.redis.set(`sandbox:${userId}`, JSON.stringify({ url: e.url, token }), 'EX', 24 * 3600);
    log.info({ userId, driver: this.cfg.driver }, 'sandbox started');
    return e;
  }

  private async waitReady(e: Entry) {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${e.url}/current`, { method: 'POST', headers: { authorization: `Bearer ${e.token}` } });
        if (r.ok) return;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new SandboxError(503, 'sandbox_timeout', 'Sandbox browser did not start');
  }

  async ensure(userId: string): Promise<Entry> {
    const e = this.entries.get(userId);
    if (e) return e;
    let p = this.starting.get(userId);
    if (!p) {
      p = this.start(userId).finally(() => this.starting.delete(userId));
      this.starting.set(userId, p);
    }
    const n = await p;
    this.entries.set(userId, n);
    return n;
  }

  async call<T = any>(userId: string, op: string, args: Record<string, unknown>): Promise<T> {
    const e = await this.ensure(userId);
    e.lastUsed = Date.now();
    const r = await fetch(`${e.url}/${op}`, { method: 'POST', headers: { authorization: `Bearer ${e.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new SandboxError(r.status, j.code ?? 'error', j.message ?? `sandbox ${op} failed`);
    return j as T;
  }

  async destroy(userId: string) {
    const e = this.entries.get(userId);
    this.entries.delete(userId);
    await this.redis.del(`sandbox:${userId}`);
    if (e?.local) await e.local.close();
    if (e?.containerId) await this.docker!.getContainer(e.containerId).stop({ t: 2 }).catch(() => {});
  }

  async reapIdle() {
    const now = Date.now();
    for (const [u, e] of this.entries) if (now - e.lastUsed > this.cfg.idleMs) await this.destroy(u);
  }

  async closeAll() {
    for (const u of [...this.entries.keys()]) await this.destroy(u);
  }
}
