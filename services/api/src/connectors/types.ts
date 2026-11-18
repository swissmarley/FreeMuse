import type { ConnectorInfo } from '@muse/core';
import type { Db } from '@muse/db';
import type { ApiConfig } from '../config.js';
import type { Vault } from '../vault.js';
import type { SandboxClient } from '../sandbox.js';

export interface ExecCtx {
  userId: string;
  db: Db;
  vault: Vault;
  cfg: ApiConfig;
  sandbox: SandboxClient;
  /** Vault id of the connection's OAuth tokens, if any. */
  vaultId?: string | null;
  approvalId?: string | null;
}

export interface OAuthStart { authorizeUrl: string }

export interface ConnectorImpl {
  id: string;
  info(cfg: ApiConfig): ConnectorInfo;
  /** Demo connectors connect immediately; OAuth connectors return a consent URL. */
  connect(ctx: Omit<ExecCtx, 'vaultId'>, scopes: string[], state: string, codeChallenge: string): Promise<OAuthStart | { account: string }>;
  /** Complete OAuth: exchange code, store tokens in the vault, return account + vault id. */
  complete?(ctx: Omit<ExecCtx, 'vaultId'>, code: string, verifier: string, scopes: string[]): Promise<{ account: string; vaultId: string }>;
  revoke?(ctx: ExecCtx): Promise<void>;
  execute(ctx: ExecCtx, operation: string, payload: Record<string, unknown>): Promise<unknown>;
}

export class ConnectorError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
