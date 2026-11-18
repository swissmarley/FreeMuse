/**
 * The executor is the single choke point for side effects. It runs an action only if:
 *   (a) it carries a valid Sentinel-signed decision bound to the exact action hash, and
 *   (b) the decision is "allow", or it is "ask" AND the user approved this exact payload in the approval inbox,
 *   (c) the connector is connected with the needed scope (re-checked here, defence in depth).
 */
import type { KeyObject } from 'node:crypto';
import type { Db } from '@muse/db';
import { appendAudit, getConnection } from '@muse/db';
import { type ActionRequest, actionHash, findOperation, loadPublic, verifyClaims } from '@muse/security';
import type { ApiConfig } from './config.js';
import { ConnectorError, type ConnectorImpl } from './connectors/index.js';
import type { SandboxClient } from './sandbox.js';
import type { Vault } from './vault.js';

export class ExecutionDenied extends Error {
  constructor(message: string) { super(message); }
}

export interface SentinelResponse { decision: 'allow' | 'deny' | 'ask'; reasons: string[]; risk: 'low' | 'medium' | 'high'; token: string; actionHash: string; exfiltration?: boolean }

export class Executor {
  private sentinelKey: KeyObject;
  constructor(private db: Db, private cfg: ApiConfig, private registry: Map<string, ConnectorImpl>, private vault: Vault, private sandbox: SandboxClient) {
    this.sentinelKey = loadPublic(cfg.sentinelPublicKey);
  }

  /** Ask the Sentinel about an action (used when the user edits a payload before approving). */
  async authorize(action: ActionRequest): Promise<SentinelResponse> {
    const r = await fetch(`${this.cfg.sentinelUrl}/authorize`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sentinel-client': this.cfg.sentinelClientToken }, body: JSON.stringify(action) });
    if (!r.ok) throw new Error(`Sentinel unavailable (${r.status})`);
    return (await r.json()) as SentinelResponse;
  }

  verify(action: ActionRequest, token: string) {
    return verifyClaims(this.sentinelKey, token, { iss: 'sentinel', u: action.userId, h: actionHash(action) });
  }

  async execute(action: ActionRequest, sentinelToken: string, approvalId?: string): Promise<unknown> {
    const claims = this.verify(action, sentinelToken);
    if (!claims) throw new ExecutionDenied('Invalid or expired Sentinel decision for this exact action');
    if (claims.d === 'deny') throw new ExecutionDenied('Sentinel denied this action');
    if (claims.d === 'ask') {
      if (!approvalId) throw new ExecutionDenied('This action needs your approval');
      const a = await this.db.one('SELECT status, payload_hash FROM approvals WHERE id=$1 AND user_id=$2', [approvalId, action.userId]);
      if (!a || a.status !== 'approved' || a.payload_hash !== actionHash(action)) throw new ExecutionDenied('No matching user approval for this action');
    }
    const op = findOperation(action.connector, action.operation);
    if (!op || op.actionClass !== action.actionClass) throw new ExecutionDenied('Unknown operation');
    const impl = this.registry.get(action.connector);
    if (!impl) throw new ExecutionDenied('Unknown connector');
    let vaultId: string | null = null;
    if (op.scope) {
      const conn = await getConnection(this.db, action.userId, action.connector);
      if (!conn || !conn.scopes.includes(op.scope)) throw new ExecutionDenied(`Permission "${op.scope}" not granted for ${action.connector}`);
      vaultId = conn.vaultId;
    }
    try {
      const result = await impl.execute({ userId: action.userId, db: this.db, vault: this.vault, cfg: this.cfg, sandbox: this.sandbox, vaultId, approvalId }, action.operation, action.payload);
      if (action.actionClass !== 'read') {
        await this.db.tx((c) => appendAudit(c, {
          userId: action.userId, kind: 'action.executed', actor: approvalId ? 'user' : 'agent',
          summary: `${op.label}${approvalId ? ' (approved by you)' : ''}`, taskId: action.taskId ?? null,
          data: { connector: action.connector, operation: action.operation, payload: action.payload, approvalId: approvalId ?? null, result },
        }));
      }
      return result;
    } catch (e) {
      if (e instanceof ConnectorError) throw e;
      throw new ConnectorError('failed', (e as Error).message);
    }
  }
}
