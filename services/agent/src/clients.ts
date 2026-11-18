/** HTTP clients for the Sentinel (authorization) and the API executor (side effects). */
import type { ActionRequest } from '@muse/security';

export interface SentinelDecision { decision: 'allow' | 'deny' | 'ask'; reasons: string[]; risk: 'low' | 'medium' | 'high'; token: string; actionHash: string; exfiltration?: boolean; reviewed?: boolean }

export interface Clients {
  authorize(a: ActionRequest): Promise<SentinelDecision>;
  execute(a: ActionRequest, sentinelToken: string): Promise<{ ok: boolean; result?: unknown; code?: string; message?: string }>;
  requestApproval(a: ActionRequest, s: SentinelDecision, preview: Record<string, unknown>): Promise<string>;
  notify(userId: string, title: string, body: string, url: string): Promise<void>;
}

export function httpClients(cfg: { sentinelUrl: string; sentinelToken: string; executorUrl: string; internalToken: string }): Clients {
  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, body: j as any };
  };
  const internal = { 'x-internal-token': cfg.internalToken };
  return {
    async authorize(a) {
      const r = await post(`${cfg.sentinelUrl}/authorize`, { 'x-sentinel-client': cfg.sentinelToken }, a);
      if (r.status !== 200) throw new Error(`Sentinel unavailable (${r.status})`);
      return r.body as SentinelDecision;
    },
    async execute(a, sentinelToken) {
      const r = await post(`${cfg.executorUrl}/internal/execute`, internal, { action: a, sentinelToken });
      return r.body;
    },
    async requestApproval(a, s, preview) {
      const r = await post(`${cfg.executorUrl}/internal/approvals`, internal, { action: a, sentinel: s, preview });
      if (r.status !== 200) throw new Error(r.body.message ?? 'Could not create approval');
      return r.body.approvalId;
    },
    async notify(userId, title, body, url) {
      await post(`${cfg.executorUrl}/internal/notify`, internal, { userId, title, body, url });
    },
  };
}
