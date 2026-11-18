import type { Redis } from 'ioredis';
import type { Db } from '@muse/db';
import type { Bus } from '@muse/runtime';
import type { ApiConfig } from './config.js';
import type { ConnectorImpl } from './connectors/index.js';
import type { Executor } from './executor.js';
import type { Notifier } from './notify.js';
import type { SandboxClient } from './sandbox.js';
import type { Vault } from './vault.js';

export interface Deps {
  db: Db;
  bus: Bus;
  cfg: ApiConfig;
  vault: Vault;
  executor: Executor;
  notifier: Notifier;
  registry: Map<string, ConnectorImpl>;
  sandbox: SandboxClient;
  redis: Redis;
  /** Dedicated subscriber connection for SSE fan-out. */
  sub: Redis;
}
