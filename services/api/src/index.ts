import { createDb, migrate } from '@muse/db';
import { Bus, log, redisConnection } from '@muse/runtime';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { buildRegistry } from './connectors/index.js';
import { Executor } from './executor.js';
import { Notifier } from './notify.js';
import { SandboxClient } from './sandbox.js';
import { Vault } from './vault.js';

const cfg = loadConfig();
const db = createDb(process.env.DATABASE_URL ?? 'postgres://muse:muse@localhost:5432/muse');
await migrate(db);
const bus = new Bus();
const redis = redisConnection();
const sub = redisConnection();
const vault = new Vault(db, cfg.vaultMasterKey);
const registry = buildRegistry(cfg);
const sandbox = new SandboxClient(redis, cfg.executorPrivateKey);
const executor = new Executor(db, cfg, registry, vault, sandbox);
const notifier = new Notifier(db, bus, cfg);

const app = await buildApp({ db, bus, cfg, vault, executor, notifier, registry, sandbox, redis, sub });
await app.listen({ host: '0.0.0.0', port: cfg.port });
log.info({ port: cfg.port }, 'api listening');

const shutdown = async () => {
  await app.close();
  await bus.close();
  redis.disconnect();
  sub.disconnect();
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
