/** Agent runtime workers: chat turns, background tasks, memory jobs, sandbox lifecycle. */
import { Worker } from 'bullmq';
import { createDb } from '@muse/db';
import { createEmbedder, createProvider, ScriptedProvider } from '@muse/llm';
import { Bus, env, log, QUEUES, redisConnection, type MemoryJob, type TaskJob, type TurnJob } from '@muse/runtime';
import { httpClients } from './clients.js';
import { extractMemories, proactive, reflect } from './memory.js';
import { handleTurn } from './orchestrator.js';
import type { AgentDeps } from './runtime.js';
import { SandboxManager } from './sandbox-manager.js';
import { scriptedBrain } from './scripted-brain.js';
import { recoverTasks, runTask } from './tasks.js';
import { memoryJob } from './workers.js';

const db = createDb(env('DATABASE_URL'));
const bus = new Bus();
const redis = redisConnection();
const scripted = process.env.LLM_PROVIDER === 'scripted';
const llm = scripted ? new ScriptedProvider(scriptedBrain) : createProvider(process.env);
const sandbox = new SandboxManager({
  driver: (process.env.SANDBOX_DRIVER as 'docker' | 'local') ?? 'local',
  image: process.env.SANDBOX_IMAGE ?? 'muse-sandbox:latest',
  network: process.env.SANDBOX_NETWORK ?? 'muse-sandbox',
  runtime: process.env.SANDBOX_RUNTIME || undefined,
  egressProxyUrl: process.env.EGRESS_PROXY_URL || undefined,
  proxySecret: env('SANDBOX_PROXY_SECRET'),
  executorPublicKey: env('EXECUTOR_PUBLIC_KEY'),
  idleMs: Number(process.env.SANDBOX_IDLE_MIN ?? 15) * 60_000,
}, redis);

const deps: AgentDeps = {
  db, bus, llm, redis, sandbox,
  embedder: createEmbedder(process.env),
  clients: httpClients({ sentinelUrl: process.env.SENTINEL_URL ?? 'http://localhost:4100', sentinelToken: env('SENTINEL_CLIENT_TOKEN'), executorUrl: process.env.EXECUTOR_URL ?? 'http://localhost:4000', internalToken: env('INTERNAL_TOKEN') }),
  model: process.env.LLM_MODEL || 'muse-spark-1.3',
  effort: (process.env.LLM_EFFORT as AgentDeps['effort']) ?? 'high',
  webSearch: !scripted && (process.env.LLM_PROVIDER ?? 'responses') === 'responses',
  allowContributorMode: process.env.ALLOW_CONTRIBUTOR_MODE !== 'false',
};

const connection = redisConnection();
const workers = [
  new Worker<TurnJob>(QUEUES.turns, (j) => handleTurn(deps, j.data), { connection, concurrency: Number(process.env.TURN_CONCURRENCY ?? 8) }),
  new Worker<TaskJob>(QUEUES.tasks, (j) => runTask(deps, j.data), { connection: redisConnection(), concurrency: Number(process.env.TASK_CONCURRENCY ?? 4), lockDuration: 10 * 60_000 }),
  new Worker<MemoryJob>(QUEUES.memory, (j) => memoryJob(deps, j.data, { extractMemories, reflect, proactive }), { connection: redisConnection(), concurrency: 2 }),
];
for (const w of workers) w.on('failed', (j, e) => log.warn({ queue: w.name, job: j?.id, err: e.message }, 'job failed'));

// Periodic jobs: reflection (daily) and proactive suggestions (every PROACTIVE_INTERVAL_MIN).
await bus.queues.memory.upsertJobScheduler('reflect-all', { every: 24 * 3600_000 }, { name: 'reflect-all', data: { userId: '*', kind: 'reflect' } });
await bus.queues.memory.upsertJobScheduler('proactive-all', { every: Number(process.env.PROACTIVE_INTERVAL_MIN ?? 240) * 60_000 }, { name: 'proactive-all', data: { userId: '*', kind: 'proactive' } });

const sub = redisConnection();
await sub.subscribe('sandbox:destroy');
sub.on('message', (_c, userId) => { void sandbox.destroy(userId); });
setInterval(() => { void sandbox.reapIdle(); }, 60_000);
const recovered = await recoverTasks(deps);
log.info({ recovered, llm: llm.name, sandbox: process.env.SANDBOX_DRIVER ?? 'local' }, 'agent workers running');

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await sandbox.closeAll();
  await bus.close();
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
